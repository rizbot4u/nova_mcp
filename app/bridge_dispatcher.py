"""
Bridge dispatcher: routes Jarvis skill execution to the Nova MCP Bridge.
"""
import json
import requests
from jsonschema import validate, ValidationError

BRIDGE_URL = "http://localhost:8001/skills/execute"
BRIDGE_TIMEOUT_SEC = 10


def execute_bridge_skill(skill_name: str, parameters: dict) -> dict:
    try:
        response = requests.post(
            BRIDGE_URL,
            headers={"Content-Type": "application/json"},
            json={
                "skill_name": skill_name,
                "org_id": "org_1",
                "actor": "jarvis",
                "parameters": parameters,
            },
            timeout=BRIDGE_TIMEOUT_SEC,
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        return {
            "status": "bridge_error",
            "skill_name": skill_name,
            "message": str(e),
        }


def execute_skill_with_bridge_routing(skill, active_version, parameters: dict, actor: str):
    # configuration is stored as a JSON string in SkillVersion
    cfg_raw = active_version.configuration
    config = json.loads(cfg_raw) if isinstance(cfg_raw, str) else cfg_raw

    # 1. Validate input
    schema = config.get("parameters_schema")
    if schema:
        try:
            validate(instance=parameters, schema=schema)
        except ValidationError as e:
            return {
                "skill": skill.name,
                "status": "validation_error",
                "result": str(e.message),
                "input": parameters,
                "executed_by": actor,
                "organization_id": getattr(skill, "organization_id", None),
                "version": getattr(active_version, "version_number", 1),
            }

    # 2. Route via bridge if configured
    bridge_skill_name = config.get("bridge_skill_name")
    if bridge_skill_name:
        bridge_result = execute_bridge_skill(bridge_skill_name, parameters)
        status = "bridge_error" if bridge_result.get("status") == "bridge_error" else "executed_via_bridge"
        return {
            "skill": skill.name,
            "status": status,
            "result": bridge_result,
            "input": parameters,
            "executed_by": actor,
            "organization_id": getattr(skill, "organization_id", None),
            "version": getattr(active_version, "version_number", 1),
        }

    # 3. Fallback stub (unchanged behavior)
    return {
        "skill": skill.name,
        "status": "executed",
        "result": "Skill executed with validation",
        "input": parameters,
        "executed_by": actor,
        "organization_id": getattr(skill, "organization_id", None),
        "version": getattr(active_version, "version_number", 1),
    }
