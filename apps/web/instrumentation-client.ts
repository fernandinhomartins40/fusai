import { z } from 'zod';

// Runs before the app in the browser. zod 4 probes `new Function('')` to decide whether it can
// compile fast parsers; under our CSP (no 'unsafe-eval') every probe is a violation report.
// Form schemas are tiny, so the interpreted parser costs nothing noticeable.
z.config({ jitless: true });
