use super::*;

#[test]
fn the_embedded_app_icon_decodes_to_a_128_square_of_rgba() {
    let icon = embedded().expect("the embedded icon must decode");

    assert_eq!(icon.width(), 128);
    assert_eq!(icon.height(), 128);
    assert_eq!(icon.rgba().len(), 128 * 128 * 4);
}

#[test]
fn the_app_icon_is_in_colour_rather_than_a_silhouette() {
    let icon = embedded().expect("the embedded icon must decode");

    let coloured = icon
        .rgba()
        .chunks_exact(4)
        .any(|pixel| pixel[3] > 0 && (pixel[0] != pixel[1] || pixel[1] != pixel[2]));

    assert!(coloured, "the app icon should be the logo, in its own colours");
}

#[test]
fn bytes_that_are_not_a_png_are_an_error_rather_than_a_panic() {
    let error = decode_png(b"not a png at all").expect_err("garbage must not decode");

    assert!(error.to_string().contains("PNG header"), "{error}");
}

#[test]
fn the_tray_mark_is_the_default_size() {
    let mark = tray().expect("the tray mark must render");

    assert_eq!(mark.width(), TRAY_ICON_SIZE);
    assert_eq!(mark.height(), TRAY_ICON_SIZE);
}

#[test]
fn the_tray_mark_renders_at_whatever_size_a_panel_asks_for() {
    for size in [22u32, 48, 256] {
        let mark = tray_mark(size).expect("the tray mark must render");
        assert_eq!(mark.width(), size);
        assert_eq!(mark.rgba().len(), (size as usize) * (size as usize) * 4);
    }
}

#[test]
fn the_tray_mark_is_white_everywhere_and_carries_its_shape_in_alpha() {
    let mark = tray().expect("the tray mark must render");
    let rgba = mark.rgba();

    for pixel in rgba.chunks_exact(4) {
        assert_eq!(
            &pixel[..3],
            &[255, 255, 255],
            "the tray mark must be monochrome white"
        );
    }
    assert!(
        rgba.chunks_exact(4).any(|pixel| pixel[3] == 255),
        "the tray mark must actually draw something"
    );
    assert!(
        rgba.chunks_exact(4).any(|pixel| pixel[3] == 0),
        "the tray mark must be a silhouette, not a filled square"
    );
}

#[test]
fn the_tray_mark_is_the_simplified_three_chevron_one_and_not_the_logo() {
    // The logo has seven chevrons and turns to grey mush below about 60px; the tray mark has three.
    // If anyone ever points the tray back at `icon.svg` this fails, which is the whole reason it is
    // asserted rather than assumed.
    let silhouette = svg::parse(EMBEDDED_SVG).expect("the embedded SVG must parse");

    assert_eq!(silhouette.polygon_count(), 3);
}

#[test]
fn the_tray_mark_keeps_clear_air_between_its_bands_at_the_size_it_is_drawn() {
    // Bands that meet are what "fuzzy" was. Down the centre column of the rendered mark there must
    // be three runs of ink with gaps between them — not one smear.
    let size = TRAY_ICON_SIZE;
    let rgba = tray().expect("renders").rgba().to_vec();
    let column = size / 2;
    let mut runs = 0;
    let mut ink = false;
    for row in 0..size {
        let index = ((row as usize) * (size as usize) + column as usize) * 4 + 3;
        let lit = rgba[index] > 128;
        if lit && !ink {
            runs += 1;
        }
        ink = lit;
    }

    assert_eq!(runs, 3, "the three bands must not run into each other");
}

