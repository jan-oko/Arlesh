use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use super::*;

fn issuer() -> PinIssuer {
    Arc::new(|| {
        Box::pin(async {
            Ok(IssuedPin {
                pin: "12345678".to_owned(),
                expires_at: "2026-11-07T10:05:00".to_owned(),
            })
        })
    })
}

fn request(host: &str, origin: Option<&str>) -> Request<Body> {
    let mut builder = Request::post("/agents/pin").header("host", host);
    if let Some(origin) = origin {
        builder = builder.header("origin", origin);
    }
    builder.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn a_loopback_request_with_no_origin_gets_a_pin() {
    let response = router(issuer())
        .oneshot(request("127.0.0.1:4747", None))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_request_from_a_web_page_is_refused() {
    let response = router(issuer())
        .oneshot(request("127.0.0.1:4747", Some("https://example.org")))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_request_for_another_host_is_refused() {
    let response = router(issuer())
        .oneshot(request("example.org", None))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
