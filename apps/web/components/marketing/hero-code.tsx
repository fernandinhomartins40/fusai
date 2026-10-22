import { API_URL } from '@/lib/config';

/** Hero code sample: the official OpenAI SDK, with only baseURL and the key changed. */
export function HeroCode() {
  return (
    <figure className="overflow-hidden rounded-2xl border bg-card text-left shadow-sm">
      <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
        <span aria-hidden className="size-2.5 rounded-full bg-muted-foreground/30" />
        <span aria-hidden className="size-2.5 rounded-full bg-muted-foreground/30" />
        <span aria-hidden className="size-2.5 rounded-full bg-muted-foreground/30" />
        <figcaption className="ml-2 text-muted-foreground text-xs">app.ts</figcaption>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed sm:p-5">
        <code>
          <span className="text-muted-foreground">import</span> OpenAI{' '}
          <span className="text-muted-foreground">from</span> 'openai';
          {'\n\n'}
          <span className="text-muted-foreground">const</span> client ={' '}
          <span className="text-muted-foreground">new</span> OpenAI({'{'}
          {'\n'}
          <span className="hero-swap-out block">{"  baseURL: 'https://api.openai.com/v1',"}</span>
          <span className="hero-swap-in block text-fusai-accent">
            {`  baseURL: '${API_URL}/v1',`}
          </span>
          {'  apiKey: process.env.FUSAI_API_KEY,\n'}
          {'});\n\n'}
          <span className="text-muted-foreground">const</span> res ={' '}
          <span className="text-muted-foreground">await</span> client.chat.completions.create({'{'}
          {"\n  model: 'fuse/auto', "}
          <span className="text-muted-foreground">{'// o mais barato que atende'}</span>
          {"\n  messages: [{ role: 'user', content: 'Olá!' }],\n});"}
        </code>
      </pre>
    </figure>
  );
}
