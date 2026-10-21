# Supabase Migration Guide (Option 1: Express + Supabase / PostgreSQL)

This guide walks you through migrating CropSathi from MongoDB to Supabase.

---

## Architecture Overview

```
[ Frontend: HTML5 / Vanilla JS ]
               │
               ▼ (Identical REST / JSON contracts & JWT Bearer token)
[ Express API Gateway (Node.js) ]
               │
               ▼ (@supabase/supabase-js with service_role)
[ Supabase PostgreSQL + PostGIS + Storage ]
```

- **Frontend Impact:** **0%** — No frontend JavaScript, HTML, URLs, or cookies are changed.
- **Authentication:** Custom JWT tokens and bcrypt password hashes are preserved.
- **Spatial Geometry:** Native PostGIS `GEOMETRY(Polygon, 4326)` for field boundaries, area calculation, and centroid computations.
- **Photos:** Supabase Storage bucket `case-photos`.

---

## Step 1: Create a Supabase Project

1. Log in to [supabase.com](https://supabase.com) and click **"New project"**.
2. Name the project **CropSathi** (or any name you prefer).
3. Set a strong database password and select a region close to your users (e.g., `South Asia (Mumbai)`).
4. Wait ~2 minutes for Supabase to provision the PostgreSQL database.

---

## Step 2: Run the Database DDL Schema

1. Open your Supabase Dashboard.
2. In the left sidebar, click **SQL Editor** -> **New query**.
3. Copy and paste the entire contents of [`backend/src/config/supabase-schema.sql`](../backend/src/config/supabase-schema.sql).
4. Click **Run** (or `Ctrl + Enter`).
5. You should see `Success. No rows returned`. All 14 tables, PostGIS extensions, indexes, foreign keys, and triggers are now created.

---

## Step 3: Create the Storage Bucket for Photos

1. In the Supabase Dashboard left sidebar, click **Storage**.
2. Click **New bucket**.
3. Name the bucket: `case-photos`.
4. Turn **Public bucket** ON (so that uploaded leaf photos can be rendered on the advisory and diagnosis pages).
5. Click **Save**.

---

## Step 4: Configure Your Environment Variables

1. In Supabase Dashboard, go to **Project Settings** (gear icon) -> **API**.
2. Copy:
   - **Project URL** (e.g., `https://xyzcompany.supabase.co`)
   - **Project API Keys** -> find the `service_role` key (click **Reveal secret key**).
     *(Note: Always use `service_role` on the backend so Express can read and write across tables bypassing client-side RLS).*
3. Open `backend/.env` and add:
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_secret_key
   ```

---

## Step 5: Seed Crop & Disease Catalogs

Run the catalog seed script from the backend directory:
```bash
cd backend
npm run seed:supabase
```
You will see:
```text
🌱 Seeding crop catalogs into Supabase...
✅ Seeded 9 crops into Supabase
🌱 Seeding disease catalogs into Supabase...
✅ Seeded 14 diseases into Supabase
🎉 Supabase catalog seed completed successfully!
```

---

## Step 6: Start the Backend

Start the development server:
```bash
npm run dev
```

You should see:
```text
⏳ Connecting to Supabase (PostgreSQL)...
✅ Supabase Connected Successfully: https://your-project-id.supabase.co
🚀 CropSathi Backend running on http://localhost:5000
```

---

## Tables Reference

| Table Name | Description | Key Columns / Spatial Type |
|---|---|---|
| `users` | Farmer profiles & notification preferences | `id (UUID)`, `phone_number (UNIQUE)`, `farm_details (JSONB)` |
| `fields` | Farm plots & polygons | `boundary GEOMETRY(Polygon, 4326)`, `polygon (JSONB)` |
| `crop_catalogs` | Priority crops (Cotton, Soybean, etc.) | `code (UNIQUE)`, `typical_sowing_window (JSONB)` |
| `disease_catalogs` | Pathogens & diseases mapped to crops | `code (UNIQUE)`, `crop_code (FK)` |
| `crop_baselines` | NDVI/NDRE percentile baselines | `crop_type`, `region`, `ndvi_p05`, `ndvi_p95` |
| `ndvi_readings` | Sentinel-2 satellite optical readings | `farm_id (FK)`, `ndvi`, `ndre`, `ndvi_grid (JSONB)` |
| `thermal_readings` | Landsat thermal & canopy temp readings | `farm_id (FK)`, `estimated_canopy_temp_c`, `thermal_grid (JSONB)` |
| `risk_scores` | Multi-signal fusion disease risk scores | `farm_id (FK)`, `composite_score`, `health_level` |
| `diagnosis_cases` | Crop disease diagnosis cases | `farm_id (FK)`, `gemini_result (JSONB)`, `status` |
| `case_photos` | Leaf images & metadata | `case_id (FK)`, `storage_key`, `storage_url` |
| `advisories` | IPM remedies & chemical recommendations | `case_id (FK)`, `remedies (JSONB)`, `severity` |
| `follow_ups` | Scheduled treatment verification | `case_id (FK)`, `status`, `farmer_response (JSONB)` |
| `reminders` | Spray application & harvest wait timers | `advisory_id (FK)`, `due_at`, `status` |
| `notifications` | Farmer alerts & push notifications | `user_id (FK)`, `type`, `priority`, `read` |
