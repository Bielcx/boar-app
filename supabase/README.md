# Supabase backend

Receives evaluation runs that users choose to share from the app. Nothing is sent
automatically, and the offline build has no network access at all.

- `migrations/`: the `eval_runs` and `eval_rows` tables. RLS is on with no policies, so the
  publishable key can't read or write them; only the Edge Function writes, with the secret key.
- `functions/submit-results/`: checks the publishable key, validates and caps the payload,
  allows 20 runs a day per install and stores only a SHA-256 of the install id.

## Using your own project

```bash
supabase link --project-ref <your-project-ref>
supabase db push
supabase functions deploy submit-results --no-verify-jwt
```

Then copy `.env.example` to `.env` and set your project's URL and publishable key.
