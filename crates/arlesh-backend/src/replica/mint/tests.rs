use super::*;

#[test]
fn a_request_without_an_id_gets_one_and_a_chosen_id_is_kept() {
    let mut request = CreateTaskRequest::default();
    request.mint_id();
    let minted = request.id;
    assert!(minted.is_some());

    request.mint_id();

    assert_eq!(request.id, minted, "minting twice changes nothing");
}
