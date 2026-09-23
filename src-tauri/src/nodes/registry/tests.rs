use chrono::NaiveDate;

use super::*;
use crate::nodes::key::{OccurrenceKey, TemplateItem, TemplateKind};

#[test]
fn a_remembered_key_is_recalled_by_its_id() {
    let key = DerivedKey::Occurrence(OccurrenceKey {
        item: TemplateItem {
            item_type: TemplateKind::FlowTask,
            item_id: 900_001,
        },
        iteration: crate::scopes::key::ScopeKey::day(NaiveDate::from_ymd_opt(2031, 1, 1).unwrap()),
        cycle: 0,
    });
    let id = remember(&key);
    assert_eq!(id, key.id());
    assert_eq!(recall(&id), Some(key));
}

#[test]
fn an_id_never_served_is_not_recalled() {
    assert_eq!(recall(&DerivedId::of_key("never:served")), None);
}
