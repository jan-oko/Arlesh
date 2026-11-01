//! [`HttpBackend`]'s `domains` operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

use crate::{
    domains::model::{CreateDomainRequest, Domain, DomainSubtype, UpdateDomainRequest},
    duplicate::DuplicatedSubtree,
    error::WireError,
};

use super::{segment, Call, HttpBackend};
use crate::backend::domains::DomainsPort;
use reqwest::Method;

#[async_trait::async_trait]
impl DomainsPort for HttpBackend {
    async fn create_domain(&self, request: CreateDomainRequest) -> Result<Domain, WireError> {
        self.write(Call::new(Method::POST, "/domains".to_owned()).json(&request))
            .await
    }

    async fn get_domain(&self, id: i64) -> Result<Domain, WireError> {
        self.read(Call::new(Method::GET, format!("/domains/{}", segment(&id))))
            .await
    }

    async fn list_domains(&self, subtype: Option<DomainSubtype>) -> Result<Vec<Domain>, WireError> {
        self.read(
            Call::new(Method::GET, "/domains".to_owned()).query_opt("subtype", subtype.as_ref()),
        )
        .await
    }

    async fn update_domain(
        &self,
        id: i64,
        request: UpdateDomainRequest,
    ) -> Result<Domain, WireError> {
        self.write(Call::new(Method::PATCH, format!("/domains/{}", segment(&id))).json(&request))
            .await
    }

    async fn delete_domain(&self, id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!("/domains/{}", segment(&id)),
        ))
        .await
    }

    async fn duplicate_domain(
        &self,
        id: i64,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Domain>, WireError> {
        self.write(
            Call::new(Method::POST, format!("/domains/{}/duplicate", segment(&id)))
                .query("target_id", &target_id)
                .query("position", &position),
        )
        .await
    }
}
