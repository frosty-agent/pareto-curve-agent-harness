# Pareto Curve Agent Harness

A Dockerized TypeScript CLI that derives an explicit, observable coding-capability vs. expected-cost ladder from the [OpenRouter Models API](https://openrouter.ai/api/v1/models).

It uses OpenRouter's concrete executable model IDs, token pricing, and embedded Artificial Analysis benchmark scores. It does **not** scrape the OpenRouter Pareto Router UI.

## Output

The CLI writes JSON containing up to 10 models by default. Every model contains:

- `codingIndex`, `intelligenceIndex`, and `agenticIndex`
- expected cost for the supplied input/output token mix
- input/output price per million tokens
- explicit image/video input/output capability booleans
- `isParetoOptimal`, distinguishing the strict cost-vs-coding frontier from dominated fill models

## Run with Docker

Build the image:

```bash
docker build -t pareto-curve-agent-harness .
```

The public catalog can be read without auth:

```bash
docker run --rm pareto-curve-agent-harness \
  --input-tokens 10000 --output-tokens 2000 --limit 10 --exclude-preview
```

To pass the OpenRouter key from AWS Secrets Manager without storing it in the image or repository:

```bash
export OPENROUTER_API_KEY="$(aws secretsmanager get-secret-value \
  --region us-east-1 \
  --secret-id arn:aws:secretsmanager:us-east-1:417007888903:secret:pareto-curve-openrouter-api-key-pVzq38 \
  --query SecretString --output text)"

docker run --rm -e OPENROUTER_API_KEY pareto-curve-agent-harness \
  --input-tokens 10000 --output-tokens 2000 --limit 10 --exclude-preview
unset OPENROUTER_API_KEY
```

The key is optional for the catalog endpoint. When supplied, the CLI sends it only as an OpenRouter authorization header and reports `authConfigured: true`; it never prints the key.

## Policy controls

```bash
# Limit providers and require tool-calling support
docker run --rm pareto-curve-agent-harness \
  --allow-provider openai,anthropic,google \
  --require-tools \
  --exclude-preview
```

Models must have an AA Coding Index to be eligible. The program removes dominated models—models for which another eligible model is at least as capable and no more expensive—then orders the frontier from lower to higher Coding Index. If the strict frontier has fewer than `--limit` models, dominated models are appended and marked `isParetoOptimal: false`.

## Development

```bash
npm install
npm test
npm run build
npm run start -- --limit 10
```
