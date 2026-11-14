//! `nodes::rules::parenting`: which kinds may hold which.

use arlesh_rules::nodes::kind::NodeKind;
use arlesh_rules::nodes::rules::parenting::may_parent;
use wasm_bindgen::prelude::*;

use crate::wire::read;

/// `may_parent`: whether a node of kind `child` may hang directly under one of kind `parent`.
#[wasm_bindgen(js_name = mayParent)]
pub fn may_parent_js(
    #[wasm_bindgen(unchecked_param_type = "NodeKindWire")] child: JsValue,
    #[wasm_bindgen(unchecked_param_type = "NodeKindWire")] parent: JsValue,
) -> Result<bool, JsError> {
    let child: NodeKind = read(child)?;
    let parent: NodeKind = read(parent)?;
    Ok(may_parent(child, parent))
}
