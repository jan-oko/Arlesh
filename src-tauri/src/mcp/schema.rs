//! Every tool's input schema, flattened to one object.
//!
//! Each tool takes an `operation`-tagged enum, which schemars describes as a `oneOf` of one object
//! per operation. That is exact, but Claude Code merges the branches' parameters and keeps
//! `operation` as the **first** branch's single `const`, so every other operation exists only in
//! prose. So the served schema is flattened: one object whose `operation` is an enum of every
//! operation and whose properties are every operation's parameters, typed, required only where
//! every operation needs them. Which operation takes which is said in the tool's description, one
//! line per operation, and enforced where it always was: deserialising the enum refuses a missing
//! field, naming it.
//!
//! Every `"default": null` is dropped on the way, anywhere in the schema: a parameter left out
//! means "unchanged" and `null` means "clear", and a client that fills in defaults would otherwise
//! turn every omission into a clear.
//!
//! Done here, once, over the schemas the tool macros generated, so the enums and their handlers
//! stay exactly as they are.

use std::sync::Arc;

use rmcp::model::{JsonObject, Tool};
use serde_json::{Map, Value};

/// Flattens `tool`'s input schema when it is a `oneOf` of operations, lists the operations in its
/// description, and drops every null default.
pub(super) fn flatten_tool(tool: &mut Tool) {
    let mut schema = (*tool.input_schema).clone();
    let listing = match flatten(&schema) {
        Some((flat, lines)) => {
            schema = flat;
            Some(format!(
                "Operations (set `operation` to one; `?` marks an optional parameter):\n{}",
                lines.join("\n")
            ))
        }
        None => None,
    };
    let mut value = Value::Object(schema);
    drop_null_defaults(&mut value);
    if let Value::Object(schema) = value {
        tool.input_schema = Arc::new(schema);
    }
    if let Some(listing) = listing {
        tool.description = Some(match tool.description.take() {
            Some(description) => format!("{description}\n\n{listing}").into(),
            None => listing.into(),
        });
    }
}

/// Removes every `"default": null` in `schema`, at any depth.
fn drop_null_defaults(schema: &mut Value) {
    match schema {
        Value::Object(fields) => {
            if fields.get("default").is_some_and(Value::is_null) {
                fields.remove("default");
            }
            for value in fields.values_mut() {
                drop_null_defaults(value);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(drop_null_defaults),
        _ => {}
    }
}

/// One operation's branch, read.
struct Operation {
    name: String,
    description: Option<String>,
    parameters: Vec<(String, bool)>,
}

/// The flattened schema and one description line per operation, or `None` when `schema` is
/// neither a `oneOf` of `operation`-tagged objects nor one such object.
pub(super) fn flatten(schema: &JsonObject) -> Option<(JsonObject, Vec<String>)> {
    // A one-operation tool may come as that operation's object rather than a `oneOf` of one.
    let single;
    let branches = match schema.get("oneOf") {
        Some(branches) => branches.as_array()?,
        None => {
            schema.get("properties")?.get("operation")?;
            single = vec![Value::Object(schema.clone())];
            &single
        }
    };
    let mut properties: Map<String, Value> = Map::new();
    let mut operations: Vec<Operation> = Vec::with_capacity(branches.len());
    for branch in branches {
        let branch = branch.as_object()?;
        let fields = branch.get("properties").and_then(Value::as_object);
        let name = fields
            .and_then(|fields| fields.get("operation"))
            .and_then(|operation| operation.get("const").or_else(|| single_enum(operation)))
            .and_then(Value::as_str)?
            .to_string();
        let required: Vec<&str> = branch
            .get("required")
            .and_then(Value::as_array)
            .map(|required| required.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let mut parameters = Vec::new();
        for (field, field_schema) in fields.into_iter().flatten() {
            if field == "operation" {
                continue;
            }
            parameters.push((field.clone(), required.contains(&field.as_str())));
            merge_property(&mut properties, field, field_schema);
        }
        operations.push(Operation {
            name,
            description: branch
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string),
            parameters,
        });
    }

    // Required at the top only where every operation requires it.
    let mut required = vec![Value::String("operation".into())];
    for field in properties.keys() {
        let everywhere = operations.iter().all(|operation| {
            operation
                .parameters
                .iter()
                .any(|(name, needed)| name == field && *needed)
        });
        if everywhere {
            required.push(Value::String(field.clone()));
        }
    }

    let names: Vec<Value> = operations
        .iter()
        .map(|operation| Value::String(operation.name.clone()))
        .collect();
    let mut all = Map::new();
    all.insert(
        "operation".into(),
        serde_json::json!({
            "type": "string",
            "enum": names,
            "description": "Which operation to run. The tool's description lists the parameters \
                            each one takes.",
        }),
    );
    all.extend(properties);

    let mut flat = JsonObject::new();
    for (key, value) in schema {
        if !matches!(
            key.as_str(),
            "oneOf" | "properties" | "required" | "type" | "description"
        ) {
            flat.insert(key.clone(), value.clone());
        }
    }
    flat.insert("type".into(), Value::String("object".into()));
    flat.insert("properties".into(), Value::Object(all));
    flat.insert("required".into(), Value::Array(required));

    let lines = operations.iter().map(line).collect();
    Some((flat, lines))
}

/// `{"enum": ["x"]}`'s one value — the form some generators give a tag instead of `const`.
fn single_enum(schema: &Value) -> Option<&Value> {
    match schema.get("enum")?.as_array()?.as_slice() {
        [only] => Some(only),
        _ => None,
    }
}

/// Adds `field` to the flattened properties. The same name in two operations with two different
/// types becomes an `anyOf` of both, so neither loses its type.
fn merge_property(properties: &mut Map<String, Value>, field: &str, schema: &Value) {
    let Some(existing) = properties.get_mut(field) else {
        properties.insert(field.to_string(), schema.clone());
        return;
    };
    let added = without_description(schema);
    let kept = without_description(existing);
    if kept == added {
        return;
    }
    let mut merged = Map::new();
    merged.insert("anyOf".into(), Value::Array(vec![kept, added]));
    if let Some(description) = existing.get("description") {
        merged.insert("description".into(), description.clone());
    }
    *existing = Value::Object(merged);
}

fn without_description(schema: &Value) -> Value {
    let mut schema = schema.clone();
    if let Value::Object(fields) = &mut schema {
        fields.remove("description");
    }
    schema
}

/// `` - `name`(a, b?): what it does `` — required parameters first, then its first paragraph.
fn line(operation: &Operation) -> String {
    // Required ones first: the order a caller needs them in, whatever order the schema kept.
    let mut ordered: Vec<&(String, bool)> = operation.parameters.iter().collect();
    ordered.sort_by_key(|(_, required)| !required);
    let parameters: Vec<String> = ordered
        .into_iter()
        .map(|(name, required)| match required {
            true => name.clone(),
            false => format!("{name}?"),
        })
        .collect();
    let summary = operation
        .description
        .as_deref()
        .map(|description| {
            let first = description.split("\n\n").next().unwrap_or(description);
            format!(": {}", first.replace('\n', " "))
        })
        .unwrap_or_default();
    format!("- `{}`({}){summary}", operation.name, parameters.join(", "))
}

#[cfg(test)]
mod tests;
