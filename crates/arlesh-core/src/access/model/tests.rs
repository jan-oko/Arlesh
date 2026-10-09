//! The node tables and how a reference spells each.

use super::*;

const TABLES: [NodeTable; 11] = [
    NodeTable::Domain,
    NodeTable::Goal,
    NodeTable::Task,
    NodeTable::Commitment,
    NodeTable::Expectation,
    NodeTable::Info,
    NodeTable::Flow,
    NodeTable::FlowGoal,
    NodeTable::FlowTask,
    NodeTable::FlowCommitment,
    NodeTable::FlowExpectation,
];

#[test]
fn every_table_reads_back_from_its_own_spelling() {
    for table in TABLES {
        assert_eq!(NodeTable::from_reference(table.as_str()), Some(table));
    }
}

#[test]
fn a_domains_row_named_by_any_of_its_subtypes_reads_as_the_domains_table() {
    for subtype in ["aspect", "project", "domain", "tag"] {
        assert_eq!(
            NodeTable::from_reference(subtype),
            Some(NodeTable::Domain),
            "{subtype}"
        );
    }
}
