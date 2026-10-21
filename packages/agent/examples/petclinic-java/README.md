# granthai-agent + Spring PetClinic REST (Java)

[Spring PetClinic REST](https://github.com/spring-petclinic/spring-petclinic-rest) is the classic Spring Boot reference app in **Java**: owners, pets, visits, vets and specialties behind a JSON REST API.

Here you run its Docker image unchanged, put `granthai-agent` in front of it, and watch an OpenAPI spec and MCP tools build up from real API calls. There's no Springdoc and no annotations: the agent only sees HTTP.

```
curl / frontend ──► :4000 granthai-agent ──► :9966 PetClinic (Java, Spring Boot)
                         │
                         ├─ /_granthai/api-docs   Swagger UI
                         └─ /_granthai/mcp        MCP tools
```

## Prerequisites

- Docker running (Docker Desktop, colima, OrbStack, ...)
- Node.js 18.17+ (for the agent and the MCP client)
- Free ports `9966` (PetClinic) and `4000` (agent)

## 1. Start PetClinic

```bash
cd packages/agent/examples/petclinic-java
./setup.sh
```

This runs `springcommunity/spring-petclinic-rest:4.0.2` on http://localhost:9966/petclinic with an in-memory database seeded with sample owners, pets and vets. Running it again is safe.

The image is amd64 only. On Apple Silicon, Docker runs it under emulation, so the first boot takes about a minute.

To run from source instead, use `git clone https://github.com/spring-petclinic/spring-petclinic-rest && cd spring-petclinic-rest && ./mvnw spring-boot:run` (JDK 17+). It listens on the same port.

## 2. Start the agent

```bash
npx granthai-agent --target 9966 --title "PetClinic API"
```

No `--route` flags are needed. PetClinic uses numeric IDs, which the agent turns into named parameters on its own: `/owners/12/pets/14` → `/owners/{ownerId}/pets/{petId}`.

## 3. Send traffic through the agent

In a second terminal, watch MCP tools appear:

```bash
node ../mcp.mjs watch
```

In a third, replay a typical session with curl: browse vets and owners, register Ada Lovelace and her dog, book a visit, update and cancel.

```bash
./traffic.sh
```

```
GET     /petclinic/api/vets                                  200
GET     /petclinic/api/owners?lastName=Davis                 200
POST    /petclinic/api/owners                                201
PUT     /petclinic/api/owners/12                             204
POST    /petclinic/api/owners/12/pets                        201
POST    /petclinic/api/owners/12/pets/14/visits              201
DELETE  /petclinic/api/visits/5                              204
...
```

Then open **http://localhost:4000/_granthai/api-docs**:

```
GET    /petclinic/api/owners
POST   /petclinic/api/owners
GET    /petclinic/api/owners/{ownerId}
PUT    /petclinic/api/owners/{ownerId}
POST   /petclinic/api/owners/{ownerId}/pets
GET    /petclinic/api/owners/{ownerId}/pets/{petId}
POST   /petclinic/api/owners/{ownerId}/pets/{petId}/visits
GET    /petclinic/api/vets/{vetId}
DELETE /petclinic/api/visits/{visitId}
...
```

PetClinic ships its own handwritten spec at http://localhost:9966/petclinic/v3/api-docs, so you can compare the two.

## 4. Talk to the MCP server

```bash
node ../mcp.mjs tools
node ../mcp.mjs call get_petclinic_api_owners_ownerId '{"ownerId":1}'
node ../mcp.mjs call post_petclinic_api_owners_ownerId_pets_petId_visits \
  '{"ownerId":1,"petId":1,"body":{"date":"2026-12-01","description":"Booked by an AI agent over MCP"}}'
```

```
HTTP 201

{"description":"Booked by an AI agent over MCP","id":6,"petId":1,"date":"2026-12-01"}
```

With Claude Code:

```bash
claude mcp add --transport http petclinic http://localhost:4000/_granthai/mcp
```

Then ask *"Which vets specialise in surgery?"* or *"Book a check-up next Monday for George Franklin's cat."*

## Clean up

```bash
# stop the agent with Ctrl+C, then:
./setup.sh down
rm -f granthai.openapi.json
```
