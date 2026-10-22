# Fontes

`geist-sans-latin.woff2` e `geist-mono-latin.woff2` são subsets das fontes variáveis Geist do pacote
`geist` (licença SIL OFL, ver `OFL.txt`). Contêm o Latin-1 e os símbolos que a interface usa
(→ … — • “ ” ≤ ≥ ✓), com os eixos de peso e o recurso `tnum`. Ficam ~60% menores que as originais.

Para regenerar (por exemplo, ao usar caracteres fora desse conjunto), com `pip install fonttools brotli`:

```bash
U="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2264-2265,U+2713,U+FEFF,U+FFFD"
pyftsubset node_modules/geist/dist/fonts/geist-sans/Geist-Variable.ttf --unicodes="$U" \
  --layout-features+=tnum --flavor=woff2 --output-file=geist-sans-latin.woff2
pyftsubset node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.ttf --unicodes="$U" \
  --layout-features+=tnum --flavor=woff2 --output-file=geist-mono-latin.woff2
```

Caracteres fora do subset continuam aparecendo, com a fonte do sistema.
