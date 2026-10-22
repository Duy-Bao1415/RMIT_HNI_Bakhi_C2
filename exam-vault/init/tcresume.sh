#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Zero-Leak Exam Vault - finish realm provisioning on the 5 linked accounts.
#
#  The free-tier licence stopped new Tide accounts after 5 were linked, so the
#  demo cast is mapped onto them BEFORE the firstAdmin -> multiAdmin flip:
#    committee2 -> first tide-realm-admin (committee chair)
#    lecturer2  -> IT admin: realm role "admin" + user management, NO decrypt
#  Then it runs steps 11-15 of tcinit.sh for committee2 (sign IdP settings,
#  grant tide-realm-admin = the one-way flip, export tidecloak.json).
#
#  Usage (from exam-vault/):  NEW_REALM_NAME=zlexam bash init/tcresume.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"

TIDECLOAK_LOCAL_URL="${TIDECLOAK_LOCAL_URL:-http://localhost:8080}"
REALM_NAME="${NEW_REALM_NAME:-zlexam}"
KC_USER="${KC_USER:-admin}"
KC_PASSWORD="${KC_PASSWORD:?set KC_PASSWORD to the TideCloak master admin password}"
CLIENT_NAME="${CLIENT_NAME:-myclient}"
FIRST_ADMIN="${FIRST_ADMIN:-committee2}"
IT_ADMIN_USER="${IT_ADMIN_USER:-lecturer2}"
ADAPTER_OUTPUT_PATH="${ADAPTER_OUTPUT_PATH:-${SCRIPT_DIR}/../tidecloak.json}"
TIDE_CONSOLE_ORIGIN="${TIDECLOAK_LOCAL_URL}/realms/${REALM_NAME}/tide-console/"
BASE="${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}"

get_admin_token() {
  curl -s -X POST "${TIDECLOAK_LOCAL_URL}/realms/master/protocol/openid-connect/token" \
    --data-urlencode "username=${KC_USER}" --data-urlencode "password=${KC_PASSWORD}" \
    -d grant_type=password -d client_id=admin-cli | jq -r .access_token
}

RESP_CODE=""; RESP_BODY=""
api() {
  local method="$1" url="$2"; shift 2
  local tmp; tmp="$(mktemp)"
  RESP_CODE=$(curl -s -o "${tmp}" -w "%{http_code}" -X "${method}" "${url}" \
    -H "Authorization: Bearer $(get_admin_token)" "$@") || RESP_CODE="000"
  RESP_BODY="$(cat "${tmp}")"; rm -f "${tmp}"
}

# Approve pending change requests (FirstAdmin mode: server-side, no enclave).
# Never approves DISABLE_IGA / DELETE_REALM / OFFBOARD_REALM.
drain() {
  local label="$1" rounds=0 ids id st
  echo "Draining change-requests ${label}..."
  while (( rounds < 12 )); do
    api GET "${BASE}/iga/change-requests?status=PENDING" -H "Cache-Control: no-store"
    [[ "${RESP_CODE}" == 2* ]] || { echo "FATAL: list CRs -> ${RESP_CODE}" >&2; exit 1; }
    ids=$(jq -r '.[] | select(.actionType | IN("DISABLE_IGA","DELETE_REALM","OFFBOARD_REALM") | not) | .id' <<< "${RESP_BODY}")
    [[ -z "${ids}" ]] && { echo "  inbox empty ${label}"; return 0; }
    while IFS= read -r id; do
      [[ -z "$id" ]] && continue
      st=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/iga/change-requests/${id}/approve" \
        -H "Authorization: Bearer $(get_admin_token)" -H "Content-Type: application/json" -d '{}')
      echo "  approve ${id} -> ${st}"
    done <<< "${ids}"
    rounds=$((rounds + 1))
  done
  echo "  WARN drain hit round cap ${label}"
}

user_id() {
  api GET "${BASE}/users?username=$1&exact=true"
  jq -r '.[0].id // empty' <<< "${RESP_BODY}"
}

api GET "${BASE}/clients?clientId=realm-management"
RM_UUID="$(jq -r '.[0].id' <<< "${RESP_BODY}")"

# ── 1. Commit the enrollment change requests (tideUserKey / vuid) ─────────────
drain "(after enrollment)"

# ── 2. lecturer2 -> IT admin ─────────────────────────────────────────────────
echo "Re-mapping ${IT_ADMIN_USER} -> IT admin..."
IT_ID="$(user_id "${IT_ADMIN_USER}")"
[[ -n "${IT_ID}" ]] || { echo "ERROR: ${IT_ADMIN_USER} not found" >&2; exit 1; }
api GET "${BASE}/roles/admin"
api POST "${BASE}/users/${IT_ID}/role-mappings/realm" -H "Content-Type: application/json" \
  -d "$(jq -c '[{id,name}]' <<< "${RESP_BODY}")"
echo "  + realm role admin -> ${RESP_CODE}"
api GET "${BASE}/clients/${RM_UUID}/roles"
api POST "${BASE}/users/${IT_ID}/role-mappings/clients/${RM_UUID}" -H "Content-Type: application/json" \
  -d "$(jq -c '[.[] | select(.name|IN("view-realm","view-users","query-users","manage-users")) | {id,name}]' <<< "${RESP_BODY}")"
echo "  + user management roles -> ${RESP_CODE}"
drain "(after IT admin grant)"
api GET "${BASE}/users/${IT_ID}/role-mappings/realm"
DEL_REP="$(jq -c '[.[] | select(.name=="contributor" or .name=="_tide_encryptor") | {id,name}]' <<< "${RESP_BODY}")"
if [[ "${DEL_REP}" != "[]" ]]; then
  api DELETE "${BASE}/users/${IT_ID}/role-mappings/realm" -H "Content-Type: application/json" -d "${DEL_REP}"
  echo "  - contributor/_tide_encryptor -> ${RESP_CODE}"
  drain "(after IT admin cleanup)"
fi

# ── 3. Sign the tide IdP settings for this realm's console origin ────────────
echo "Signing tide IdP settings..."
api GET "${BASE}/identity-provider/instances/tide"
[[ "${RESP_CODE}" == 2* ]] || { echo "ERROR: get tide IdP -> ${RESP_CODE}" >&2; exit 1; }
IDP_FILE="$(mktemp)"
jq --arg d "${TIDE_CONSOLE_ORIGIN}" '.config.CustomAdminUIDomain = $d' <<< "${RESP_BODY}" > "${IDP_FILE}"
api PUT "${BASE}/identity-provider/instances/tide" -H "Content-Type: application/json" --data-binary @"${IDP_FILE}"
rm -f "${IDP_FILE}"
[[ "${RESP_CODE}" == 2* ]] || { echo "ERROR: update tide IdP -> ${RESP_CODE} ${RESP_BODY}" >&2; exit 1; }
api POST "${BASE}/vendorResources/sign-idp-settings" -H "Content-Type: text/plain" --data-binary ""
[[ "${RESP_CODE}" == 2* ]] || { echo "ERROR: sign-idp-settings -> ${RESP_CODE} ${RESP_BODY}" >&2; exit 1; }
echo "  IdP settings signed -> ${RESP_CODE}"

# ── 4. Grant tide-realm-admin to committee2, final drain = firstAdmin -> multiAdmin
USER_ID="$(user_id "${FIRST_ADMIN}")"
[[ -n "${USER_ID}" ]] || { echo "ERROR: ${FIRST_ADMIN} not found" >&2; exit 1; }
echo "Granting tide-realm-admin to ${FIRST_ADMIN} (${USER_ID})..."
api GET "${BASE}/clients/${RM_UUID}/roles/tide-realm-admin"
ROLE_REP="${RESP_BODY}"
api POST "${BASE}/users/${USER_ID}/role-mappings/clients/${RM_UUID}" -H "Content-Type: application/json" -d "[${ROLE_REP}]"
echo "  grant -> ${RESP_CODE}"
drain "(final: grant + firstAdmin->multiAdmin flip)"

# ── 5. Export the adapter config ─────────────────────────────────────────────
api GET "${BASE}/clients?clientId=${CLIENT_NAME}"
CLIENT_UUID="$(jq -r '.[0].id // empty' <<< "${RESP_BODY}")"
code=$(curl -s -o "${ADAPTER_OUTPUT_PATH}" -w "%{http_code}" \
  "${BASE}/vendorResources/get-installations-provider?clientId=${CLIENT_UUID}&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer $(get_admin_token)")
[[ "${code}" == 2* ]] || { echo "ERROR: adapter export -> ${code}" >&2; exit 1; }
echo "Adapter config saved to ${ADAPTER_OUTPUT_PATH}"
jq '{realm, resource, jwk: has("jwk"), vendorId: has("vendorId"), homeOrkUrl: has("homeOrkUrl")}' "${ADAPTER_OUTPUT_PATH}"
echo "All done. ${FIRST_ADMIN} is tide-realm-admin; ${IT_ADMIN_USER} is the IT admin."
