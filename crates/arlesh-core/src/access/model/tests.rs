//! The node tables and how a reference column spells each.

use super::*;

const TABLES: [NodeTable; 9] = [
    NodeTable::Domain,
    NodeTable::Goal,
    NodeTable::Task,
    NodeTable::Commitment,
    NodeTable::Expectation,
    NodeTable::Info,
    NodeTable::Flow,
    NodeTable::FlowGoal,
    NodeTable::FlowTask,
];

#[test]
fn every_spelling_of_a_table_reads_back_as_that_table() {
    for table in TABLES {
        for spelling in table.reference_spellings() {
            assert_eq!(
                NodeTable::from_reference(spelling),
                Some(table),
                "{spelling}"
            );
        }
    }
}

#[test]
fn a_domains_row_is_named_by_any_of_its_subtypes() {
    assert_eq!(
        NodeTable::Domain.reference_spellings(),
        &["aspect", "project", "domain", "tag"]
    );
}
