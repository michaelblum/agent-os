We are in {{repoRoot}}.

You are the foreman role for workflow {{workflowId}}.

Use this generated role directory only as launch/control context:

{{roleDir}}

Read the GDI handoff sentinel first:

{{readyPath}}

Perform the foreman integration pass. When complete, write this JSON sentinel:

{{donePath}}

The done file may be as small as `{"status":"done"}`.
