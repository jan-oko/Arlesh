//! Ids for the rows a write creates, chosen on the device.
//!
//! A create names its row's id (`id`), so the Replica can show the row under it and the server,
//! given the same request, makes the row under the same one. A caller that already chose one keeps
//! it.

use arlesh_core::{
    domains::model::CreateDomainRequest,
    flows::model::{CreateFlowItemRequest, CreateFlowRequest},
    infos::model::CreateInfoRequest,
    nodes::new_id::new_row_id,
    tasks::model::{
        CreateCommitmentRequest, CreateExpectationRequest, CreateGoalRequest, CreateTaskRequest,
    },
};

/// A create request that carries the id of the row it makes.
pub trait MintsId {
    /// Gives the request an id when it has none.
    fn mint_id(&mut self);
}

macro_rules! mints {
    ($($request:ty),* $(,)?) => {
        $(
            impl MintsId for $request {
                fn mint_id(&mut self) {
                    if self.id.is_none() {
                        self.id = Some(new_row_id());
                    }
                }
            }
        )*
    };
}

mints!(
    CreateTaskRequest,
    CreateGoalRequest,
    CreateCommitmentRequest,
    CreateExpectationRequest,
    CreateFlowRequest,
    CreateFlowItemRequest,
    CreateDomainRequest,
    CreateInfoRequest,
);

#[cfg(test)]
mod tests {
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
}
