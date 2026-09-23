# Render SERVICE_ID to the exact application service before installing this policy.
path "secret/data/SERVICE_ID/*" {
  capabilities = ["read"]
}

path "auth/token/renew-self" {
  capabilities = ["update"]
}
