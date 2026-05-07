We are in {{repoRoot}}.

You are the foreman role for docked session supervisor run {{workflowId}}.

Your registered AOS role session id is `{{roleSessionId}}`.

Use this generated role directory only as launch/control context:

{{roleDir}}

Read the GDI handoff sentinel first:

{{readyPath}}

Perform the foreman integration pass. When complete, write this JSON sentinel:

{{donePath}}

The done file may be as small as `{"status":"done"}`.
