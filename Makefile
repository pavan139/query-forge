PYTHON ?= python
.PHONY: test demo evaluate
test:
	PYTHONPATH=src $(PYTHON) -m unittest discover -s conformance -v
demo:
	PYTHONPATH=src $(PYTHON) -m query_forge demo --output artifacts/demo.json
evaluate:
	PYTHONPATH=src $(PYTHON) -m query_forge evaluate --output artifacts/evaluation.json
