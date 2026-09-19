use super::*;
use serde_json::json;

/// A section of `count` items, each padded to roughly `size` characters.
fn section(section: Section, count: usize, size: usize) -> SectionItems {
    SectionItems {
        section,
        items: (0..count)
            .map(|n| json!({"id": n, "pad": "x".repeat(size)}))
            .collect(),
    }
}

/// The cursor a walk over exactly these sections starts from.
fn first_cursor(available: &[SectionItems]) -> Cursor {
    Cursor {
        section: available.first().expect("a fixture has sections").section,
        offset: 0,
    }
}

/// Follows the cursor to exhaustion, returning every item of every section in page order.
fn walk_to_exhaustion(
    available: &[SectionItems],
    budget: usize,
) -> (Vec<(Section, Value)>, usize) {
    let mut seen = Vec::new();
    let mut cursor = first_cursor(available);
    let mut pages = 0;

    loop {
        let page = take_page(available, cursor, budget).expect("cursor came from a page");
        pages += 1;
        for (section, items) in page.sections {
            for item in items {
                seen.push((section, item));
            }
        }
        match page.next {
            Some(next) => cursor = next,
            None => break,
        }
        assert!(pages < 500, "paging did not terminate");
    }
    (seen, pages)
}

/// Every item the sections hold, flattened in walk order.
fn everything(available: &[SectionItems]) -> Vec<(Section, Value)> {
    available
        .iter()
        .flat_map(|held| held.items.iter().map(|item| (held.section, item.clone())))
        .collect()
}

#[test]
fn a_payload_under_budget_is_one_page_with_no_cursor() {
    let available = vec![section(Section::Domains, 3, 10), section(Section::Tasks, 2, 10)];

    let page = take_page(&available, first_cursor(&available), 40_000).unwrap();

    assert!(page.next.is_none(), "nothing left, so no cursor");
    assert_eq!(page.sections.len(), 2);
}

#[test]
fn following_the_cursor_yields_every_item_exactly_once_and_in_order() {
    // Sized so the walk has to break mid-section more than once.
    let available = vec![
        section(Section::Domains, 40, 100),
        section(Section::Goals, 5, 100),
        section(Section::Tasks, 60, 100),
    ];

    let (seen, pages) = walk_to_exhaustion(&available, 2_000);

    assert!(pages > 1, "this fixture is meant to need several pages");
    assert_eq!(
        seen,
        everything(&available),
        "paging must lose nothing, duplicate nothing and reorder nothing"
    );
}

#[test]
fn a_section_larger_than_the_budget_splits_and_resumes() {
    let available = vec![section(Section::Tasks, 30, 200)];

    let first = take_page(&available, first_cursor(&available), 1_000).unwrap();
    let resume = first.next.expect("30 big items cannot fit in 1000 characters");

    assert_eq!(resume.section, Section::Tasks);
    assert!(resume.offset > 0 && resume.offset < 30, "split mid-section");

    let (seen, _) = walk_to_exhaustion(&available, 1_000);
    assert_eq!(seen.len(), 30);
}

#[test]
fn an_empty_section_is_carried_as_empty_rather_than_skipped() {
    // The distinction the whole design rests on: a caller must be able to tell "none" from
    // "not yet".
    let available = vec![
        section(Section::Domains, 1, 10),
        section(Section::BlockReasons, 0, 0),
    ];

    let page = take_page(&available, first_cursor(&available), 40_000).unwrap();

    let block_reasons = page
        .sections
        .iter()
        .find(|(section, _)| *section == Section::BlockReasons)
        .expect("an empty section is still visited");
    assert!(block_reasons.1.is_empty());
}

#[test]
fn a_single_item_over_budget_is_still_emitted_alone() {
    // Otherwise the page is empty, the cursor does not advance, and the caller loops forever.
    let available = vec![section(Section::Tasks, 3, 5_000)];

    let page = take_page(&available, first_cursor(&available), 100).unwrap();

    assert_eq!(page.sections[0].1.len(), 1, "progress beats the budget");
    assert_eq!(page.next.map(|cursor| cursor.offset), Some(1));

    let (seen, _) = walk_to_exhaustion(&available, 100);
    assert_eq!(seen.len(), 3, "and the walk still terminates");
}

#[test]
fn a_cursor_round_trips_through_its_token() {
    let cursor = Cursor {
        section: Section::Lifecycles,
        offset: 193,
    };
    assert_eq!(cursor.as_token(), "lifecycles:193");
    assert_eq!(Cursor::parse("lifecycles:193").unwrap(), cursor);
}

#[test]
fn a_malformed_cursor_is_rejected_rather_than_guessed_at() {
    for bad in ["lifecycles", "nosuchsection:0", "tasks:-1", "tasks:many", ""] {
        let rejected = Cursor::parse(bad);
        assert!(rejected.is_err(), "\"{bad}\" should not parse");
    }
}

#[test]
fn a_cursor_past_the_end_of_a_shrunken_section_says_so() {
    // Pages re-derive, so the board can shrink under a caller mid-walk.
    let available = vec![section(Section::Tasks, 2, 10)];

    let rejected = take_page(
        &available,
        Cursor {
            section: Section::Tasks,
            offset: 9,
        },
        40_000,
    );

    assert!(rejected.is_err());
}

#[test]
fn a_cursor_naming_a_section_this_request_excluded_is_rejected() {
    // `sections: ["tasks"]` then a cursor into `habits` is a caller mistake, not an empty page.
    let available = vec![section(Section::Tasks, 1, 10)];

    let rejected = take_page(
        &available,
        Cursor {
            section: Section::Habits,
            offset: 0,
        },
        40_000,
    );

    assert!(rejected.is_err());
}

#[test]
fn every_section_of_the_payload_is_pageable() {
    // Guards the drift this design is most exposed to: a fifteenth field added to the payload
    // would otherwise never be paged, and an agent would never see it.
    let payload = serde_json::to_value(crate::mindmap::model::MindmapLoad::default())
        .expect("the payload serializes");
    let fields: Vec<&str> = payload
        .as_object()
        .expect("the payload is an object")
        .keys()
        .map(String::as_str)
        .collect();

    for field in &fields {
        assert!(
            SECTIONS.iter().any(|section| section.as_str() == *field),
            "payload field \"{field}\" has no Section, so it would never be paged"
        );
    }
    assert_eq!(
        fields.len(),
        SECTIONS.len(),
        "Section has entries the payload does not"
    );
}
