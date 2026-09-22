use super::*;

const SQUARE: &str = r##"<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
  <polygon points="2,2 8,2 8,8 2,8" fill="#123456"/>
</svg>"##;

fn square() -> Silhouette {
    parse(SQUARE).expect("the test square must parse")
}

#[test]
fn a_view_box_is_read_as_four_numbers() {
    assert_eq!(
        square().view_box(),
        ViewBox {
            min_x: 0.0,
            min_y: 0.0,
            width: 10.0,
            height: 10.0
        }
    );
}

#[test]
fn every_polygon_in_the_document_is_read() {
    let svg = r#"<svg viewBox="0 0 10 10">
        <polygon points="0,0 4,0 4,4"/>
        <polygon points="5,5 9,5 9,9"/>
    </svg>"#;

    assert_eq!(parse(svg).expect("two polygons").polygon_count(), 2);
}

#[test]
fn a_comment_between_polygons_is_not_mistaken_for_one() {
    let svg = r#"<svg viewBox="0 0 10 10">
        <!-- the first band -->
        <polygon points="0,0 4,0 4,4"/>
    </svg>"#;

    assert_eq!(parse(svg).expect("one polygon").polygon_count(), 1);
}

#[test]
fn a_point_inside_a_polygon_is_inside_the_mark() {
    assert!(square().contains(Point { x: 5.0, y: 5.0 }));
}

#[test]
fn a_point_outside_every_polygon_is_outside_the_mark() {
    assert!(!square().contains(Point { x: 0.5, y: 0.5 }));
    assert!(!square().contains(Point { x: 9.5, y: 9.5 }));
}

#[test]
fn a_document_with_no_view_box_is_refused_by_name() {
    let error = parse("<svg><polygon points=\"0,0 1,0 1,1\"/></svg>").expect_err("no viewBox");

    assert!(matches!(error, SvgError::MissingViewBox), "{error}");
}

#[test]
fn a_view_box_that_is_not_four_numbers_is_refused() {
    let error = parse("<svg viewBox=\"0 0 10\"><polygon points=\"0,0 1,0 1,1\"/></svg>")
        .expect_err("three numbers");

    assert!(matches!(error, SvgError::BadViewBox(_)), "{error}");
}

#[test]
fn a_view_box_with_no_area_is_refused() {
    let error = parse("<svg viewBox=\"0 0 0 10\"><polygon points=\"0,0 1,0 1,1\"/></svg>")
        .expect_err("zero width");

    assert!(matches!(error, SvgError::BadViewBox(_)), "{error}");
}

#[test]
fn points_that_are_not_pairs_are_refused() {
    let error =
        parse("<svg viewBox=\"0 0 10 10\"><polygon points=\"0,0 1,0 1\"/></svg>").expect_err("odd");

    assert!(matches!(error, SvgError::BadPoints(_)), "{error}");
}

#[test]
fn a_polygon_with_fewer_than_three_points_is_refused() {
    let error = parse("<svg viewBox=\"0 0 10 10\"><polygon points=\"0,0 1,1\"/></svg>")
        .expect_err("a line is not a polygon");

    assert!(matches!(error, SvgError::BadPoints(_)), "{error}");
}

#[test]
fn a_polygon_with_no_points_at_all_is_refused() {
    let error =
        parse("<svg viewBox=\"0 0 10 10\"><polygon fill=\"red\"/></svg>").expect_err("no points");

    assert!(matches!(error, SvgError::BadPoints(_)), "{error}");
}

#[test]
fn points_that_are_not_numbers_are_refused() {
    let error = parse("<svg viewBox=\"0 0 10 10\"><polygon points=\"a,b c,d e,f\"/></svg>")
        .expect_err("letters");

    assert!(matches!(error, SvgError::BadPoints(_)), "{error}");
}

#[test]
fn a_document_with_nothing_to_draw_is_refused() {
    let error =
        parse("<svg viewBox=\"0 0 10 10\"><circle r=\"4\"/></svg>").expect_err("no polygon");

    assert!(matches!(error, SvgError::NoPolygons), "{error}");
}

#[test]
fn a_render_is_a_square_rgba_buffer_of_the_size_asked_for() {
    for size in [16u32, 32, 128] {
        assert_eq!(
            square().rasterise(size).len(),
            (size as usize) * (size as usize) * 4
        );
    }
}

#[test]
fn a_render_of_nothing_at_all_is_empty_rather_than_a_panic() {
    assert!(square().rasterise(0).is_empty());
}

#[test]
fn every_pixel_of_a_render_is_white_and_says_its_coverage_in_alpha() {
    let rgba = square().rasterise(32);

    for pixel in rgba.as_chunks::<4>().0 {
        assert_eq!(&pixel[..3], &[255, 255, 255], "a pixel was not white");
    }
    let pixels = rgba.as_chunks::<4>().0;
    assert!(pixels.iter().any(|p| p[3] == 255), "nothing is drawn");
    assert!(pixels.iter().any(|p| p[3] == 0), "nothing is clear");
}

#[test]
fn the_middle_of_the_mark_is_opaque_and_the_corner_is_clear() {
    let size = 20u32;
    let rgba = square().rasterise(size);
    let alpha_at = |column: u32, row: u32| {
        let index = ((row as usize) * (size as usize) + column as usize) * 4 + 3;
        rgba[index]
    };

    assert_eq!(alpha_at(size / 2, size / 2), 255);
    assert_eq!(alpha_at(0, 0), 0);
}

#[test]
fn a_taller_document_is_centred_in_the_square_rather_than_stretched() {
    // A full-width, full-height band in a viewBox twice as tall as it is wide: fitted to a square,
    // the drawn part must sit in the middle columns and leave the outer ones clear.
    let svg = r#"<svg viewBox="0 0 10 20"><polygon points="0,0 10,0 10,20 0,20"/></svg>"#;
    let size = 20u32;
    let rgba = parse(svg).expect("parses").rasterise(size);
    let alpha_at = |column: u32, row: u32| {
        let index = ((row as usize) * (size as usize) + column as usize) * 4 + 3;
        rgba[index]
    };

    assert_eq!(alpha_at(size / 2, size / 2), 255, "the middle is drawn");
    assert_eq!(alpha_at(0, size / 2), 0, "the left margin is clear");
    assert_eq!(alpha_at(size - 1, size / 2), 0, "the right margin is clear");
}

#[test]
fn a_comment_can_say_anything_without_being_read_as_markup() {
    let svg = r##"<svg viewBox="0 0 10 10">
        <!-- viewBox="9 9 9 9" and a <polygon points="0,0 1,0 1,1"/> written out in prose -->
        <polygon points="2,2 8,2 8,8 2,8"/>
    </svg>"##;
    let parsed = parse(svg).expect("the real markup, not the comment");

    assert_eq!(parsed.polygon_count(), 1);
    assert_eq!(parsed.view_box().width, 10.0);
}

#[test]
fn an_unterminated_comment_swallows_the_rest_rather_than_reading_past_it() {
    let error = parse("<svg viewBox=\"0 0 10 10\"><!-- <polygon points=\"0,0 1,0 1,1\"/>")
        .expect_err("nothing is left to draw");

    assert!(matches!(error, SvgError::NoPolygons), "{error}");
}
