//! A very small SVG reader: enough for `icons/tray.svg`, and deliberately no more.
//!
//! The tray wants a flat white mark at whatever size the panel asks for, and the true description
//! of that mark is a vector — so it is rasterised from one rather than resampled from a PNG
//! somebody exported once at one size, which is what makes a tray icon soft. A general SVG
//! renderer would be a large dependency for a file that is three `<polygon>` elements, so this
//! reads exactly that and names anything else as an error rather than quietly drawing a blank.

#[cfg(test)]
mod tests;

/// What this reader cannot do with an SVG.
#[derive(Debug, thiserror::Error)]
pub enum SvgError {
    /// The document has no `viewBox`, so there is no user space to scale from.
    #[error("the SVG has no viewBox")]
    MissingViewBox,
    /// The `viewBox` is not four numbers with a positive width and height.
    #[error("the viewBox is not four positive numbers: {0}")]
    BadViewBox(String),
    /// A `<polygon>` has no usable `points`.
    #[error("a polygon's points are not at least three pairs of numbers: {0}")]
    BadPoints(String),
    /// The document contains no `<polygon>`, which is the only element this reader draws.
    #[error("the SVG has no <polygon>, and nothing else is supported")]
    NoPolygons,
}

/// One point in the SVG's user space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    /// Horizontal position, in user units.
    pub x: f32,
    /// Vertical position, in user units.
    pub y: f32,
}

/// The rectangle of user space the document maps onto its output.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ViewBox {
    /// Left edge, in user units.
    pub min_x: f32,
    /// Top edge, in user units.
    pub min_y: f32,
    /// Width, in user units.
    pub width: f32,
    /// Height, in user units.
    pub height: f32,
}

/// An SVG reduced to its outline: the polygons, and the box they live in.
///
/// Colour is dropped on the way in, which is the point — a tray sits on a bar whose colour is not
/// ours to know, so the mark goes on it as one flat shape.
#[derive(Debug, Clone, PartialEq)]
pub struct Silhouette {
    view_box: ViewBox,
    polygons: Vec<Vec<Point>>,
}

/// Samples per pixel side. Four means sixteen per pixel, enough to keep these diagonals from
/// stepping at the sizes a tray uses.
const SAMPLES_PER_SIDE: u32 = 4;

impl Silhouette {
    /// The box the polygons are expressed in.
    pub fn view_box(&self) -> ViewBox {
        self.view_box
    }

    /// How many polygons were read.
    pub fn polygon_count(&self) -> usize {
        self.polygons.len()
    }

    /// Whether a point in user space falls inside the mark.
    ///
    /// The union of the polygons rather than their even-odd combination: two overlapping bands of
    /// one silhouette must not cancel each other into a hole.
    pub fn contains(&self, point: Point) -> bool {
        self.polygons.iter().any(|polygon| encloses(polygon, point))
    }

    /// Renders the mark as a square `size`×`size` RGBA buffer, white throughout, with coverage
    /// carried entirely by the alpha channel.
    ///
    /// The `viewBox` is fitted to the square, so a document that is not square is centred in it
    /// rather than stretched to fill it.
    pub fn rasterise(&self, size: u32) -> Vec<u8> {
        let pixels = (size as usize) * (size as usize);
        let mut rgba = vec![0u8; pixels * 4];
        if size == 0 {
            return rgba;
        }

        let scale = self.view_box.width.max(self.view_box.height) / size as f32;
        let span = size as f32 * scale;
        let offset_x = self.view_box.min_x - (span - self.view_box.width) / 2.0;
        let offset_y = self.view_box.min_y - (span - self.view_box.height) / 2.0;
        let samples = SAMPLES_PER_SIDE * SAMPLES_PER_SIDE;

        for row in 0..size {
            for column in 0..size {
                let mut hits = 0u32;
                for sub_y in 0..SAMPLES_PER_SIDE {
                    for sub_x in 0..SAMPLES_PER_SIDE {
                        let point = Point {
                            x: offset_x + (column as f32 + centre(sub_x)) * scale,
                            y: offset_y + (row as f32 + centre(sub_y)) * scale,
                        };
                        if self.contains(point) {
                            hits += 1;
                        }
                    }
                }
                let index = ((row as usize) * (size as usize) + column as usize) * 4;
                let alpha = u8::try_from((hits * 255) / samples).unwrap_or(u8::MAX);
                // Written through a checked slice rather than by index: the buffer is sized for
                // exactly these writes, and an arithmetic slip should not panic at the user.
                if let Some(pixel) = rgba.get_mut(index..index + 4) {
                    pixel[0] = u8::MAX;
                    pixel[1] = u8::MAX;
                    pixel[2] = u8::MAX;
                    pixel[3] = alpha;
                }
            }
        }
        rgba
    }
}

/// Where within a pixel one subsample sits, as a fraction of the pixel.
fn centre(sub: u32) -> f32 {
    (sub as f32 + 0.5) / SAMPLES_PER_SIDE as f32
}

/// Crossing-number test for one polygon.
fn encloses(polygon: &[Point], point: Point) -> bool {
    let Some(last) = polygon.last() else {
        return false;
    };
    let mut inside = false;
    let mut previous = *last;
    for current in polygon {
        if (current.y > point.y) != (previous.y > point.y) {
            let rise = previous.y - current.y;
            if rise != 0.0 {
                let crossing_x =
                    (previous.x - current.x) * (point.y - current.y) / rise + current.x;
                if point.x < crossing_x {
                    inside = !inside;
                }
            }
        }
        previous = *current;
    }
    inside
}

/// Reads the `viewBox` and every `<polygon points="…">` out of `svg`.
///
/// Attribute scanning rather than XML parsing: the input is one committed file in this repository,
/// and everything it does not contain is an error rather than something to interpret.
pub fn parse(svg: &str) -> Result<Silhouette, SvgError> {
    let svg = strip_comments(svg);
    let raw_box = attribute(&svg, "viewBox").ok_or(SvgError::MissingViewBox)?;
    let view_box = parse_view_box(raw_box)?;

    let mut polygons = Vec::new();
    let mut rest = svg.as_str();
    while let Some(start) = rest.find("<polygon") {
        let element = rest.split_at(start).1;
        // Bounded to this element, so a polygon missing its own `points` is an error rather than
        // silently borrowing the next element's.
        let end = element.find('>').unwrap_or(element.len());
        let raw_points = attribute(element.split_at(end).0, "points")
            .ok_or_else(|| SvgError::BadPoints(String::new()))?;
        polygons.push(parse_points(raw_points)?);
        rest = element.split_at("<polygon".len()).1;
    }

    if polygons.is_empty() {
        return Err(SvgError::NoPolygons);
    }
    Ok(Silhouette { view_box, polygons })
}

/// Drops every `<!-- … -->` region.
///
/// The tray mark's own file opens with a long comment explaining why it is not the logo, and a
/// scanner that cannot see comments would read whatever an author happens to write in one.
fn strip_comments(svg: &str) -> String {
    let mut out = String::with_capacity(svg.len());
    let mut rest = svg;
    while let Some(start) = rest.find("<!--") {
        let (before, from_comment) = rest.split_at(start);
        out.push_str(before);
        match from_comment.find("-->") {
            Some(end) => rest = from_comment.split_at(end + "-->".len()).1,
            // An unterminated comment swallows the remainder, which is what a reader would do.
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// The value of the first `name="…"` in `text`.
fn attribute<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("{name}=\"");
    let start = text.find(&needle)? + needle.len();
    let value = text.split_at(start).1;
    let end = value.find('"')?;
    Some(value.split_at(end).0)
}

/// Every number in a whitespace- or comma-separated list, or `None` if any of them is not one.
fn numbers(text: &str) -> Option<Vec<f32>> {
    text.split(|c: char| c.is_whitespace() || c == ',')
        .filter(|piece| !piece.is_empty())
        .map(|piece| piece.parse::<f32>().ok())
        .collect()
}

fn parse_view_box(raw: &str) -> Result<ViewBox, SvgError> {
    let bad = || SvgError::BadViewBox(raw.to_string());
    match numbers(raw).ok_or_else(bad)?[..] {
        [min_x, min_y, width, height] if width > 0.0 && height > 0.0 => Ok(ViewBox {
            min_x,
            min_y,
            width,
            height,
        }),
        _ => Err(bad()),
    }
}

fn parse_points(raw: &str) -> Result<Vec<Point>, SvgError> {
    let bad = || SvgError::BadPoints(raw.to_string());
    let values = numbers(raw).ok_or_else(bad)?;
    if values.len() < 6 || values.len() % 2 != 0 {
        return Err(bad());
    }
    Ok(values
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&[x, y]| Point { x, y })
        .collect())
}
