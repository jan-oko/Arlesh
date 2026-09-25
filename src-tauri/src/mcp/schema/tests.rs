use super::*;

fn object(value: Value) -> JsonObject {
    match value {
        Value::Object(object) => object,
        _ => JsonObject::new(),
    }
}

fn tagged() -> JsonObject {
    object(serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "WaitsOperation",
        "oneOf": [
            {
                "type": "object",
                "description": "Raises a wait.\n\nMore detail.",
                "properties": {
                    "operation": { "type": "string", "const": "raise" },
                    "task_id": { "anyOf": [{ "type": "integer" }, { "type": "string" }] },
                    "question": { "type": "boolean", "description": "A question?" }
                },
                "required": ["operation", "task_id"]
            },
            {
                "type": "object",
                "properties": {
                    "operation": { "type": "string", "enum": ["get"] },
                    "task_id": { "type": "string" },
                    "question": { "type": "boolean" }
                },
                "required": ["operation", "task_id"]
            },
            { "type": "object", "properties": { "operation": { "const": "list" } } }
        ],
        "$defs": {
            "Brief": {
                "properties": { "spec": { "type": ["string", "null"], "default": null } }
            }
        }
    }))
}

#[test]
fn a_tagged_union_flattens_to_one_object_with_every_parameter_typed() {
    let (flat, lines) = flatten(&tagged()).unwrap_or_default();

    assert!(flat.get("oneOf").is_none());
    assert_eq!(flat["type"], "object");
    assert_eq!(
        flat["title"], "WaitsOperation",
        "the rest of the root is kept"
    );
    assert_eq!(
        flat["required"],
        serde_json::json!(["operation"]),
        "task_id is required by two operations of three, so it is not required at the top"
    );
    assert_eq!(
        flat["properties"]["operation"]["enum"],
        serde_json::json!(["raise", "get", "list"])
    );
    assert_eq!(flat["properties"]["question"]["type"], "boolean");
    assert_eq!(
        flat["properties"]["task_id"]["anyOf"],
        serde_json::json!([
            { "anyOf": [{ "type": "integer" }, { "type": "string" }] },
            { "type": "string" }
        ]),
        "two operations' different types are both kept"
    );
    assert_eq!(
        lines,
        vec![
            "- `raise`(task_id, question?): Raises a wait.",
            "- `get`(task_id, question?)",
            "- `list`()",
        ]
    );
}

#[test]
fn a_parameter_every_operation_requires_is_required_at_the_top() {
    let mut schema = tagged();
    if let Some(Value::Array(branches)) = schema.get_mut("oneOf") {
        branches.truncate(2);
    }
    let (flat, _) = flatten(&schema).unwrap_or_default();

    assert_eq!(
        flat["required"],
        serde_json::json!(["operation", "task_id"])
    );
}

#[test]
fn a_single_operation_object_flattens_too() {
    let schema = object(serde_json::json!({
        "type": "object",
        "description": "Loads it.",
        "properties": {
            "operation": { "type": "string", "const": "load" },
            "now": { "type": "string" }
        },
        "required": ["operation"]
    }));
    let (flat, lines) = flatten(&schema).unwrap_or_default();

    assert_eq!(
        flat["properties"]["operation"]["enum"],
        serde_json::json!(["load"])
    );
    assert_eq!(lines, vec!["- `load`(now?): Loads it."]);
    assert!(
        flat.get("description").is_none(),
        "it moved to the tool's description"
    );
}

#[test]
fn a_schema_that_is_not_a_tagged_union_keeps_its_shape() {
    assert!(flatten(&object(serde_json::json!({ "type": "object" }))).is_none());
    let mut tool = Tool::new("plain", "Plain.", Arc::new(object(serde_json::json!({}))));
    flatten_tool(&mut tool);
    assert_eq!(tool.description.as_deref(), Some("Plain."));
}

#[test]
fn a_flattened_tool_lists_its_operations_and_drops_every_null_default() {
    let mut tool = Tool::new("waits", "Waits.", Arc::new(tagged()));
    flatten_tool(&mut tool);

    let description = tool.description.as_deref().unwrap_or("");
    assert!(description.starts_with("Waits.\n\nOperations"));
    assert!(description.contains("- `raise`(task_id, question?)"));
    assert!(tool.input_schema.get("oneOf").is_none());
    let spec = &tool.input_schema["$defs"]["Brief"]["properties"]["spec"];
    assert!(spec.get("default").is_none(), "{spec}");
    assert_eq!(spec["type"], serde_json::json!(["string", "null"]));
}
