# AWMP First-Party Mode Examples

This directory contains executable AWMP mode packages used to validate
Leviathan's Agent Work Mode Protocol runtime.

The examples are intentionally local and deterministic:

- `modes/customer_support` turns a support-ticket fixture into a structured
  `support.analysis.report` artifact.
- `modes/ppt` turns the support analysis artifact into `presentation.outline`
  and `presentation.pptx` artifacts.
- `modes/*/examples/*.eval.json` files define regression expectations for
  required artifacts, expected metrics, artifact review fixtures, and negative
  boundary cases.
- `tasks/support_to_ppt_task.json` exercises a cross-mode workflow:
  customer support analysis -> management presentation.

Useful local commands:

```text
/awmp modes --modes examples/awmp/modes
/awmp catalog --modes examples/awmp/modes
/awmp run examples/awmp/tasks/support_to_ppt_task.json --modes examples/awmp/modes
/awmp scheduler-run <run-dir> --execute-validators
/awmp eval-mode examples/awmp/modes/customer_support --run-scheduler --execute-validators --apply-review-fixtures
/awmp eval-mode examples/awmp/modes/ppt --run-scheduler --execute-validators --apply-review-fixtures
/awmp export-bundle examples/awmp/modes/ppt --bundle .leviathan/awmp/bundles/ppt.awmp-mode.json
/awmp install-bundle .leviathan/awmp/bundles/ppt.awmp-mode.json --force
/awmp trust-keygen --public-key .leviathan/awmp/keys/demo.pub.pem --private-key .leviathan/awmp/keys/demo.key.pem
/awmp sign-mode examples/awmp/modes/ppt --publisher com.leviathan.demo --private-key .leviathan/awmp/keys/demo.key.pem
/awmp verify-signature examples/awmp/modes/ppt --publisher com.leviathan.demo --public-key .leviathan/awmp/keys/demo.pub.pem
/awmp marketplace-publish examples/awmp/modes/ppt --publisher com.leviathan.demo --private-key .leviathan/awmp/keys/demo.key.pem
/awmp marketplace-verify examples/awmp/modes/ppt --publisher com.leviathan.demo
/awmp marketplace-sync .leviathan/awmp/marketplace/mode_marketplace.json --source-id local-demo
/awmp policy-set --require-mode-signature --require-marketplace --trusted-publisher com.leviathan.demo
/awmp marketplace-revoke com.leviathan.ppt --version 0.1.0 --publisher com.leviathan.demo --reason "demo revocation"
```

The examples are not production integrations. They are proof fixtures for the
runtime contract: mode package loading, tool brokerage, artifact registration,
validator execution, scheduler progress, and evidence-backed evaluation.
Review fixtures are local regression evidence, not real user acceptance.
