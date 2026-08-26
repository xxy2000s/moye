# Python Example

This example uses only Python's standard `unittest` package. The Moye CLI remains the released Node package; the project under test does not import Moye source or require a Node application:

```bash
npm install --global moye@0.1.0
moye project validate
python3 -m unittest discover -s tests
moye doctor
moye task start \
  --objective "Add subtraction with boundary tests" \
  --accept "python3 -m unittest discover -s tests passes"
moye task watch TASK-ID
moye task open TASK-ID
```

`documentation.policy: none` still produces Workflow-owned `NOT_REQUIRED` evidence bound to the candidate; it is not an Agent self-attestation. Runtime stop and destructive cleanup remain separate operations.
