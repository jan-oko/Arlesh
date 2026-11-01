//! [`HttpBackend`]'s `infos` operations: each one REST call to `arlesh-server`, as
//! `conformance/client-mode.json` lists it.

use crate::{
    duplicate::DuplicatedSubtree,
    error::WireError,
    infos::model::{CreateInfoRequest, Info, UpdateInfoRequest},
};

use super::{segment, Call, HttpBackend};
use crate::backend::infos::InfosPort;
use reqwest::Method;

#[async_trait::async_trait]
impl InfosPort for HttpBackend {
    async fn create_info(&self, request: CreateInfoRequest) -> Result<Info, WireError> {
        self.write(Call::new(Method::POST, "/infos".to_owned()).json(&request))
            .await
    }

    async fn list_infos(&self) -> Result<Vec<Info>, WireError> {
        self.read(Call::new(Method::GET, "/infos".to_owned())).await
    }

    async fn update_info(&self, id: i64, request: UpdateInfoRequest) -> Result<Info, WireError> {
        self.write(Call::new(Method::PATCH, format!("/infos/{}", segment(&id))).json(&request))
            .await
    }

    async fn delete_info(&self, id: i64) -> Result<(), WireError> {
        self.write(Call::new(
            Method::DELETE,
            format!("/infos/{}", segment(&id)),
        ))
        .await
    }

    async fn duplicate_info(
        &self,
        id: i64,
        target_type: String,
        target_id: i64,
        position: i64,
    ) -> Result<DuplicatedSubtree<Info>, WireError> {
        self.write(
            Call::new(Method::POST, format!("/infos/{}/duplicate", segment(&id)))
                .query("target_type", &target_type)
                .query("target_id", &target_id)
                .query("position", &position),
        )
        .await
    }
}
