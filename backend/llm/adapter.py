"""Provider-agnostic LLM adapter: structured output, one validation retry, typed errors.

Agents call `structured()` (JSON-schema output validated against a Pydantic model) and
the Ask agent calls `tool_turn()`. Every call returns `CallMeta` (models asked and
answered, token usage, stop reason) so the caller can write a trace span.

Failure semantics (considerations §1.4 and §7):
- invalid output: retry once with the validation error, then raise LLMOutputInvalid
- provider refusal: LLMRefused (recorded as blocked_upstream, never as a pass)
- missing credentials: LLMUnavailable; API errors after SDK retries: LLMCallFailed
No error is ever turned into an empty or neutral result here.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.config import Settings

T = TypeVar("T", bound=BaseModel)

_FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMError(Exception):
    kind = "error"


class LLMUnavailable(LLMError):
    kind = "unavailable"


class LLMRefused(LLMError):
    kind = "blocked_upstream"


class LLMOutputInvalid(LLMError):
    kind = "invalid_output"


class LLMCallFailed(LLMError):
    kind = "api_error"


@dataclass
class CallMeta:
    provider: str
    model_requested: str
    model_responded: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    stop_reason: str | None = None
    request_id: str | None = None
    attempts: int = 0

    def add_usage(self, usage: Any) -> None:
        if usage is None:
            return
        self.input_tokens += getattr(usage, "input_tokens", 0) or 0
        self.output_tokens += getattr(usage, "output_tokens", 0) or 0
        self.cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0) or 0
        self.cache_write_tokens += getattr(usage, "cache_creation_input_tokens", 0) or 0

    def span_attributes(self) -> dict:
        """OpenTelemetry GenAI semantic-convention names (considerations §4.7)."""
        return {
            "gen_ai.system": self.provider,
            "gen_ai.request.model": self.model_requested,
            "gen_ai.response.model": self.model_responded,
            "gen_ai.usage.input_tokens": self.input_tokens,
            "gen_ai.usage.output_tokens": self.output_tokens,
            "gen_ai.usage.cache_read_input_tokens": self.cache_read_tokens,
            "gen_ai.usage.cache_creation_input_tokens": self.cache_write_tokens,
            "gen_ai.response.finish_reason": self.stop_reason,
            "llm.attempts": self.attempts,
            "llm.request_id": self.request_id,
        }


@dataclass
class ToolTurn:
    stop_reason: str | None
    text: str
    tool_calls: list[dict]
    assistant_content: list[Any]  # append unchanged to the next request (thinking blocks included)
    meta: CallMeta


@dataclass
class LLMStatus:
    provider: str
    model: str
    enabled: bool
    reason: str = ""
    refusal_fallback: str = "off"
    notes: list[str] = field(default_factory=list)


def output_schema(model: type[BaseModel]) -> dict:
    import anthropic

    return {"type": "json_schema", "schema": anthropic.transform_schema(model.model_json_schema())}


class BaseLLM:
    provider = "none"

    def __init__(self, model: str = "none"):
        self.model = model

    @property
    def enabled(self) -> bool:
        return False

    def status(self) -> LLMStatus:
        return LLMStatus(self.provider, self.model, self.enabled)

    def structured(self, *, task: str, system: str, stable_context: str, user: str,
                   schema: type[T], effort: str, max_tokens: int = 16000) -> tuple[T, CallMeta]:
        raise NotImplementedError

    def tool_turn(self, *, system: str, messages: list, tools: list[dict], effort: str,
                  max_tokens: int = 16000) -> ToolTurn:
        raise NotImplementedError


class DisabledLLM(BaseLLM):
    """Used when no provider is configured. Agents fall back to rule-based tools and say so."""

    provider = "none"

    def __init__(self, reason: str):
        super().__init__("none")
        self.reason = reason

    def status(self) -> LLMStatus:
        return LLMStatus(self.provider, self.model, False, self.reason)

    def structured(self, **_: Any):
        raise LLMUnavailable(self.reason)

    def tool_turn(self, **_: Any):
        raise LLMUnavailable(self.reason)


def _has_anthropic_credentials() -> bool:
    if os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN") or os.getenv("ANTHROPIC_PROFILE"):
        return True
    if os.getenv("ANTHROPIC_FEDERATION_RULE_ID"):
        return True
    return (Path.home() / ".config" / "anthropic").exists()


class AnthropicLLM(BaseLLM):
    provider = "anthropic"

    def __init__(self, settings: Settings):
        import anthropic

        super().__init__(settings.llm_model)
        self._anthropic = anthropic
        self.client = anthropic.Anthropic(timeout=settings.llm_timeout_s, max_retries=2)
        self.fallback = settings.llm_refusal_fallback == "default"

    @property
    def enabled(self) -> bool:
        return True

    def status(self) -> LLMStatus:
        notes = []
        if self.fallback:
            notes.append("Server-side refusal fallback is on (fallbacks='default'); set LLM_REFUSAL_FALLBACK=off to disable.")
        return LLMStatus(self.provider, self.model, True, "", "default" if self.fallback else "off", notes)

    # -- transport ---------------------------------------------------------------------------------

    def _create(self, **kwargs: Any):
        a = self._anthropic
        try:
            if self.fallback:
                return self.client.beta.messages.create(betas=[_FALLBACK_BETA], fallbacks="default", **kwargs)
            return self.client.messages.create(**kwargs)
        except (a.AuthenticationError, a.PermissionDeniedError, a.CredentialsError) as exc:
            raise LLMUnavailable(f"credentials rejected: {exc}") from exc
        except a.BadRequestError as exc:
            raise LLMCallFailed(f"bad request: {exc.message}") from exc
        except a.RateLimitError as exc:
            raise LLMCallFailed(f"rate limited after retries: {exc.message}") from exc
        except a.APIStatusError as exc:
            raise LLMCallFailed(f"API error {exc.status_code}: {exc.message}") from exc
        except (a.APIConnectionError, a.APITimeoutError) as exc:
            raise LLMCallFailed(f"connection error: {exc}") from exc

    @staticmethod
    def _text(response: Any) -> str:
        return "".join(b.text for b in response.content if getattr(b, "type", None) == "text")

    def _record(self, meta: CallMeta, response: Any) -> None:
        meta.attempts += 1
        meta.model_responded = getattr(response, "model", None)
        meta.stop_reason = getattr(response, "stop_reason", None)
        meta.request_id = getattr(response, "_request_id", None)
        meta.add_usage(getattr(response, "usage", None))
        if meta.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            category = getattr(details, "category", None) if details else None
            raise LLMRefused(f"provider declined the request (category={category})")

    # -- public API ----------------------------------------------------------------------------------

    def structured(self, *, task: str, system: str, stable_context: str, user: str,
                   schema: type[T], effort: str, max_tokens: int = 16000) -> tuple[T, CallMeta]:
        meta = CallMeta(self.provider, self.model)
        system_blocks: list[dict] = [{"type": "text", "text": system}]
        if stable_context:
            system_blocks.append({"type": "text", "text": stable_context})
        system_blocks[-1]["cache_control"] = {"type": "ephemeral"}  # stable text first, question last
        messages: list[dict] = [{"role": "user", "content": user}]
        output_config = {"effort": effort, "format": output_schema(schema)}

        last_error = ""
        for attempt in range(2):
            response = self._create(model=self.model, max_tokens=max_tokens, system=system_blocks,
                                    messages=messages, output_config=output_config)
            self._record(meta, response)
            text = self._text(response)
            try:
                if meta.stop_reason == "max_tokens":
                    raise ValueError("response truncated at max_tokens")
                return schema.model_validate_json(text), meta
            except (ValidationError, ValueError) as exc:
                last_error = str(exc)[:500]
                if attempt == 0:
                    messages = messages + [
                        {"role": "assistant", "content": response.content},
                        {"role": "user", "content": f"That was invalid: {last_error}\nReturn only the JSON object."},
                    ]
        raise LLMOutputInvalid(f"{task}: output failed validation twice: {last_error}")

    def tool_turn(self, *, system: str, messages: list, tools: list[dict], effort: str,
                  max_tokens: int = 16000) -> ToolTurn:
        meta = CallMeta(self.provider, self.model)
        response = self._create(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
            tools=tools,
            output_config={"effort": effort},
            cache_control={"type": "ephemeral"},
        )
        self._record(meta, response)
        calls = [
            {"id": b.id, "name": b.name, "input": b.input}
            for b in response.content
            if getattr(b, "type", None) == "tool_use"
        ]
        return ToolTurn(meta.stop_reason, self._text(response), calls, list(response.content), meta)


def build_llm(settings: Settings) -> BaseLLM:
    provider = settings.llm_provider.lower()
    if provider in ("none", "off", "disabled", ""):
        return DisabledLLM("LLM_PROVIDER is set to none")
    if provider != "anthropic":
        return DisabledLLM(f"unknown LLM_PROVIDER {settings.llm_provider!r}; only 'anthropic' is implemented")
    if not _has_anthropic_credentials():
        return DisabledLLM("no Anthropic credentials found: set ANTHROPIC_API_KEY in backend/.env")
    return AnthropicLLM(settings)


def dumps_content(content: list[Any]) -> list[dict]:
    """Serialise SDK content blocks (or dicts) for the trace."""
    out = []
    for b in content:
        if hasattr(b, "model_dump"):
            out.append(b.model_dump(mode="json", exclude_none=True))
        elif isinstance(b, dict):
            out.append(json.loads(json.dumps(b, default=str)))
        else:
            out.append({"repr": repr(b)})
    return out
