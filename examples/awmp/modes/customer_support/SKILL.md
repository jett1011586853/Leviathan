---
name: com.leviathan.customer_support
description: Analyze support tickets into governed support analysis artifacts.
---

# Customer Support Analysis Mode

Use this mode when the task requires support-ticket analysis, complaint
clustering, customer-impact summaries, or identifying refund actions that need
human approval.

The mode must produce a `support.analysis.report` artifact. It should keep raw
ticket details out of exported artifacts unless the task explicitly allows them.
Refund execution is not allowed directly; only approval-sensitive cases may be
listed for review.
