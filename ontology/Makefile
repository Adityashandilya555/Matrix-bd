# Ontology PoC. Everything runs against a throwaway container on 127.0.0.1:55432.
# Nothing here touches backend/, frontend/, or any Supabase project.
#
# Plain `docker run` on purpose — no compose plugin required.

PY        := $(CURDIR)/../backend/.venv/bin/python
POC       := poc
CONTAINER := matrix-ontology-poc
PORT      := 55432
IMAGE     := postgres:16-alpine

.PHONY: help up demo down psql logs reset check

help:
	@echo "make up     — start the throwaway Postgres and load schema + registry"
	@echo "make demo   — run the proofs"
	@echo "make psql   — open a shell on the PoC database"
	@echo "make down   — stop and DESTROY the container and its data"
	@echo "make reset  — down, then up (rebuild from sql/)"
	@echo "make check  — assert no file outside ontology/ was touched"

up:
	@docker rm -f -v $(CONTAINER) >/dev/null 2>&1 || true
	@docker run -d --name $(CONTAINER) \
	  -e POSTGRES_USER=matrix \
	  -e POSTGRES_PASSWORD=matrix \
	  -e POSTGRES_DB=matrix_ontology_poc \
	  -p 127.0.0.1:$(PORT):5432 \
	  -v "$(CURDIR)/$(POC)/sql:/docker-entrypoint-initdb.d:ro" \
	  $(IMAGE) >/dev/null
	@printf "  waiting for postgres"
	@for i in $$(seq 1 60); do \
	  if docker exec $(CONTAINER) pg_isready -U matrix -d matrix_ontology_poc >/dev/null 2>&1; then \
	    echo " ready"; break; \
	  fi; printf "."; sleep 1; \
	done
	@# pg_isready goes true once during init; wait for the seed to actually land
	@for i in $$(seq 1 60); do \
	  if docker exec $(CONTAINER) psql -U matrix -d matrix_ontology_poc -tAc \
	     "select count(*) from ontology.action_type" 2>/dev/null | grep -q '^[1-9]'; then \
	    break; \
	  fi; sleep 1; \
	done
	@echo "✓ postgres ready on 127.0.0.1:$(PORT) (db=matrix_ontology_poc user=matrix)"

demo:
	@cd $(POC) && $(PY) demo.py

psql:
	@docker exec -it $(CONTAINER) psql -U matrix -d matrix_ontology_poc

logs:
	@docker logs $(CONTAINER) --tail=60

down:
	@docker rm -f -v $(CONTAINER) >/dev/null 2>&1 || true
	@echo "✓ container and data removed"

reset: down up

check:
	@echo "--- application code touched by this branch (expect none) ---"
	@git diff --name-only origin/main -- ../backend ../frontend ../z-matrix-design-system \
	  | sed 's/^/  /' | grep . || echo "  none ✓"
	@echo "--- everything this branch adds vs origin/main ---"
	@git diff --name-only origin/main | sed 's/^/  /'
	@echo "  (the three Matrix_*.md/html files are the branch seed commit, 6ad6a62)"
