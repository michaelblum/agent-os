# Run Puck

The run puck is a sibling AOS daemon canvas for steerable collection run
control. It is served from the toolkit content root:

```bash
./aos show create --id run-puck-<session> --url 'aos://toolkit/run-puck/index.html?session=<session>' --track union
```

The puck emits `run.control` events through the standard WKWebView bridge. It
does not mount inside Sigil and does not need browser-page focus. Routed input
events are normalized in `hotkeys.js` and converted into semantic run-control
commands with `source: "hotkey"`.
