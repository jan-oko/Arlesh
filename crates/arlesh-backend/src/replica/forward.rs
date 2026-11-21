//! Every port method of [`ReplicaBackend`], written once, by kind (see [`super::ports`]).
//!
//! A method's body is one of a handful of shapes, chosen by its kind. The arguments are cloned
//! into the operation because it can run more than once: locally, then on the server, and again
//! if the Replica has to replay it.

/// The body of one port method, by kind.
macro_rules! method_body {
    (read $s:ident $name:ident [$($arg:ident)*]) => {{
        let local = $s.local().await?;
        local.$name($($arg),*).await
    }};
    (option_read $s:ident $name:ident [$($arg:ident)*]) => {{
        match $s.ready() {
            Some(local) => local.$name($($arg),*).await,
            None => None,
        }
    }};
    (write $s:ident $name:ident [$($arg:ident)*]) => {{
        $s.submit(move |backend| {
            $( let $arg = $arg.clone(); )*
            Box::pin(async move { backend.$name($($arg),*).await })
        })
        .await
    }};
    (create $s:ident $name:ident [$($arg:ident)*]) => {{
        $s.submit(move |backend| {
            $( let $arg = $arg.clone(); )*
            Box::pin(async move { backend.$name($($arg),*).await })
        })
        .await
    }};
    (remote $s:ident $name:ident [$($arg:ident)*]) => {{
        $s.submit(move |backend| {
            $( let $arg = $arg.clone(); )*
            Box::pin(async move { backend.$name($($arg),*).await })
        })
        .await
    }};
    (remote_read $s:ident $name:ident [$($arg:ident)*]) => {{
        $s.remote().$name($($arg),*).await
    }};
    (local $s:ident $name:ident [$($arg:ident)*]) => {{
        $s.remote().$name($($arg),*).await
    }};
    (refused $s:ident $name:ident [$($arg:ident)*]) => {{
        $s.remote().$name($($arg),*).await
    }};
    (undo $s:ident $name:ident [$($arg:ident)*]) => {{
        $s.submit(move |backend| {
            Box::pin(async move { backend.$name().await })
        })
        .await
    }};
}

/// Implements every port for [`ReplicaBackend`].
macro_rules! implement_replica {
    ( $( $port:ident in $module:ident {
            uses { $( $import:item )* }
            methods { $( $kind:ident $name:ident ( $( $arg:ident : $ty:ty ),* ) -> $ret:ty ; )* }
        } )* ) => {
        $(
            mod $module {
                #![allow(unused_imports, clippy::all)]
                use std::sync::Arc;
                $( $import )*
                use crate::replica::ReplicaBackend;
                use crate::$module::$port as _;
                use crate::undo::UndoPort as _;

                #[async_trait::async_trait]
                impl crate::$module::$port for ReplicaBackend {
                    $(
                        async fn $name(&self $(, $arg: $ty)*) -> $ret {
                            method_body!($kind self $name [$($arg)*])
                        }
                    )*
                }
            }
        )*
    };
}

super::ports::with_ports!(implement_replica);
