"""Prompt/tool-choice eval: runs the real Agent against live LM Studio with a
dry-run HA wrapper (reads real, writes recorded). Usage:

    .venv/bin/python scripts/eval.py

Prints a pass/fail table; exit code 0 only at 100%.
"""
import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openai import AsyncOpenAI

from server.config import load_config
from server.eval_support import DryRunHA
from server.ha import HomeAssistant
from server.llm import Agent, build_system_prompt


@dataclass
class Case:
    name: str
    utterance: str
    check: Callable  # (dry: DryRunHA, reply: str) -> tuple[bool, str]


def expect_service(domain, service, entity_substr, data_check=None):
    def check(dry, reply):
        for d, s, eid, data in dry.calls:
            if d == domain and s == service and entity_substr in eid:
                if data_check and not data_check(data or {}):
                    return False, f"args wrong: {data}"
                return True, ""
        return False, f"no {domain}.{service} on *{entity_substr}*; calls={dry.calls}"

    return check


def expect_no_service(reply_check=None):
    def check(dry, reply):
        if dry.calls:
            return False, f"unexpected service calls: {dry.calls}"
        if reply_check and not reply_check(reply):
            return False, f"reply check failed: {reply!r}"
        return True, ""

    return check


def first(entities, prefix, need_area=False):
    for e in entities:
        if e["entity_id"].startswith(prefix) and (e["area"] or not need_area):
            return e
    return None


def build_cases(light, switch, climate, temp_sensor):
    cases = []
    if light:
        lid = light["entity_id"]
        cases += [
            Case("light on", f"turn on the {light['name']}",
                 expect_service("light", "turn_on", lid)),
            Case("light off", f"turn off the {light['name']}",
                 expect_service("light", "turn_off", lid)),
            Case("brightness", f"dim the {light['name']} to 30 percent",
                 expect_service("light", "turn_on", lid,
                                lambda d: d.get("brightness_pct") == 30)),
        ]
        if light["area"]:
            cases.append(
                Case("area off", f"turn off the lights in the {light['area']}",
                     expect_service("light", "turn_off", "light."))
            )
    if switch:
        cases.append(
            Case("switch on", f"turn on the {switch['name']}",
                 expect_service("switch", "turn_on", switch["entity_id"])),
        )
    if climate:
        cases.append(
            Case("set temp", f"set the {climate['name']} to 22 degrees",
                 expect_service("climate", "set_temperature",
                                climate["entity_id"],
                                lambda d: d.get("temperature") in (22, 22.0))),
        )
    if temp_sensor and temp_sensor["area"]:
        cases.append(
            Case("sensor read",
                 f"what is the temperature in the {temp_sensor['area']}?",
                 expect_no_service(lambda r: any(c.isdigit() for c in r))),
        )
    cases += [
        Case("chat joke", "tell me a short joke", expect_no_service()),
        Case("chat cooking", "what's a good simple pasta sauce?",
             expect_no_service()),
        Case("greeting", "good morning!", expect_no_service()),
    ]
    return cases


async def main() -> None:
    config = load_config()
    real = HomeAssistant(config.ha_url, config.ha_token)
    await real.load_areas()
    summary = await real.entity_summary()
    entities = await real.get_entities()

    light = first(entities, "light.", need_area=True) or first(entities, "light.")
    switch = first(entities, "switch.")
    climate = first(entities, "climate.")
    temp_sensor = next(
        (e for e in entities
         if e["entity_id"].startswith("sensor.")
         and "temperature" in (e["name"] or "").lower() and e["area"]),
        None,
    )

    client = AsyncOpenAI(base_url=config.lmstudio_url, api_key="lm-studio")
    cases = build_cases(light, switch, climate, temp_sensor)

    passed = 0
    for case in cases:
        dry = DryRunHA(real)
        agent = Agent(client, config.lmstudio_model, dry,
                      build_system_prompt(summary))
        try:
            reply = await agent.run([], case.utterance)
            ok, why = case.check(dry, reply)
        except Exception as exc:
            ok, why, reply = False, f"exception: {exc}", ""
        passed += ok
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {case.name:<14} {case.utterance!r}")
        if not ok:
            print(f"       reply: {reply[:120]!r}")
            print(f"       why:   {why}")
    print(f"\n{passed}/{len(cases)} passed")
    await real.aclose()
    sys.exit(0 if passed == len(cases) else 1)


if __name__ == "__main__":
    asyncio.run(main())
