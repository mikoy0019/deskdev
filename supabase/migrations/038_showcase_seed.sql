-- ============================================
-- DeskDev Studio — 038: Showcase seed (the 88 entries on /portfolio today)
-- Every entry of site/src/app/(site)/portfolio/page.tsx, verbatim, so the
-- public page looks the same the day it starts reading the table (Q5):
--
--   8 in-house products   consent 'internal', published
--   80 client sites       consent 'legacy'; published, except the
--                        12 marked noShot (broken screenshot), which
--                        start as 'ready' (Needs review in DeskDev)
--
-- Field mapping: name -> title, category -> industry, blurb -> summary,
-- variant -> mockup_variant, live -> link_public. Client urls gain the
-- https:// the page adds when it links them. Product images keep their page
-- value in image_key; image_source is 'local' for /public files, 'mshots' for
-- the two remote captures and 'mockup' where the page sets preferMockup.
-- Client sites store no key: image_source 'mshots' renders the same live
-- 640x360 capture of the URL the page builds today, and 'none' (noShot)
-- renders the monogram. The 8 sites on the home page's work strip are
-- home_featured with its result tag.
-- slug = lower(name), runs of anything but a-z0-9 -> '-' (showcase_slugify).
-- sort_order = page position x 10 (products first), leaving room in between.
--
-- Idempotent by slug: ON CONFLICT DO NOTHING, so a re-run never overwrites
-- what an admin has changed since. Rows inserted here are not audited one by
-- one; one 'showcase.seeded' audit row records the batch.
-- Known-dead links are found by the link check (B3), which hides 'down' items.
-- Generated from the page as it stood on 2026-10-03 (rows checked against it
-- by the PGlite test); add new entries in DeskDev, not here.
-- ============================================

SELECT set_config('deskdev.showcase_seed', 'on', false);

WITH seed (
  slug, kind, title, url, link_public, industry, summary, result_tag,
  stack, accent, mockup_variant,
  image_key, image_key_small, image_source,
  status, home_featured, sort_order, consent, consent_note
) AS (
  VALUES
    ('inbox-ai', 'product', 'Inbox AI', 'https://inbox-ai-ten.vercel.app', true, 'AI Email Assistant', 'Drafts, triages, and replies to inbound email automatically so no lead or message ever slips through the cracks.', NULL, ARRAY['Next.js', 'Supabase', 'OpenAI'], '#8b5cf6', 'email', '/products/inbox-ai.png', NULL, 'local', 'published', false, 10, 'internal', 'In-house product, listed on the portfolio page before the showcase existed.'),
    ('invoice-chase', 'product', 'Invoice Chase', 'https://invoice-chase-brown.vercel.app', true, 'Automated Invoicing', 'Sends invoices and chases late payments on autopilot — get paid faster without the awkward follow-ups.', NULL, ARRAY['Next.js', 'Tailwind', 'Vercel'], '#10b981', 'invoicing', '/products/invoice-chase.png', NULL, 'local', 'published', false, 20, 'internal', 'In-house product, listed on the portfolio page before the showcase existed.'),
    ('stock-sense', 'product', 'Stock Sense', 'https://stock-sense-delta.vercel.app', true, 'Inventory Intelligence', 'Live inventory tracking with low-stock alerts and demand forecasting for product-based businesses.', NULL, ARRAY['React', 'Supabase', 'APIs'], '#f59e0b', 'inventory', '/products/stock-sense.png', NULL, 'local', 'published', false, 30, 'internal', 'In-house product, listed on the portfolio page before the showcase existed.'),
    ('supernova', 'product', 'Supernova', 'https://supernova-dashboard.vercel.app', true, 'Revenue Dashboard', 'A real-time KPI command center — campaign analytics, forecasting, and drill-down revenue tracking in one instrument panel.', NULL, ARRAY['React', 'TypeScript', 'Prisma'], '#1a6bff', 'dashboard', '/products/supernova-dashboard.png', NULL, 'mockup', 'published', false, 40, 'internal', 'In-house product, listed on the portfolio page before the showcase existed.'),
    ('pos-app', 'product', 'POS App', 'https://pos-app-rho-neon.vercel.app', true, 'Point of Sale', 'Fast, modern point-of-sale for retail and hospitality — orders, payments, and reporting in one flow.', NULL, ARRAY['React', 'Express', 'Supabase'], '#3b82f6', 'pos', '/products/pos-app.png', NULL, 'mockup', 'published', false, 50, 'internal', 'In-house product, listed on the portfolio page before the showcase existed.'),
    ('delivery-app', 'product', 'Delivery App', 'https://delivery-app-kappa-ashen.vercel.app', true, 'Delivery Platform', 'End-to-end delivery management — dispatch, live order tracking, and driver routing.', NULL, ARRAY['React', 'Express', 'Supabase'], '#a3e635', 'delivery', '/products/delivery-app.png', NULL, 'mockup', 'published', false, 60, 'internal', 'In-house product, listed on the portfolio page before the showcase existed.'),
    ('command-desk', 'product', 'Command Desk', 'https://command-desk-one.vercel.app', true, 'Operations Cockpit', 'A single operations dashboard for tasks, metrics, and team activity across the whole business.', NULL, ARRAY['React', 'Vite', 'Supabase'], '#ef4444', 'ops', 'https://s.wordpress.com/mshots/v1/https%3A%2F%2Fcommand-desk-one.vercel.app?w=1280&h=800', NULL, 'mshots', 'published', false, 70, 'internal', 'In-house product, listed on the portfolio page before the showcase existed.'),
    ('elev8te', 'product', 'Elev8te', 'https://elev8te-crm.vercel.app', true, 'CRM Platform', 'A lightweight CRM for service teams — pipeline, contacts, and automated follow-up that syncs live across every device.', NULL, ARRAY['React', 'Supabase', 'Realtime'], '#22d3ee', 'crm', 'https://s.wordpress.com/mshots/v1/https%3A%2F%2Felev8te-crm.vercel.app?w=1280&h=800', NULL, 'mshots', 'published', false, 80, 'internal', 'In-house product, listed on the portfolio page before the showcase existed.'),
    ('hike-wales', 'website', 'Hike Wales', 'https://hikewales.com', true, 'Travel / 3D', NULL, 'WebGL hero', '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', true, 90, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('upscale-rails', 'website', 'Upscale Rails', 'https://upscalerails.com', true, 'Real Estate', NULL, 'Investor portal', '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', true, 100, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('colorado-river-expeditions', 'website', 'Colorado River Expeditions', 'https://coloradoriverexpeditions.com', true, 'Travel / Tours', NULL, 'Booking system', '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', true, 110, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('four-states-concrete', 'website', 'Four States Concrete', 'https://fourstatesconcreterepair.com', true, 'Concrete', NULL, '#1 local SEO', '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', true, 120, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('gerrer-herring', 'website', 'Gerrer Herring', 'https://gerrerherring.com', true, 'Professional Services', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 130, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('shira-salon', 'website', 'Shira Salon', 'https://shirasalon.com', true, 'Salon & Beauty', NULL, 'Online booking', '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', true, 140, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('remotecruit', 'website', 'RemoteCruit', 'https://remotecruit.com', true, 'Recruiting / SaaS', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 150, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('topcore-it', 'website', 'TopCore IT', 'https://topcoreit.com', true, 'IT Services', NULL, 'B2B site', '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', true, 160, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('klubz-korner', 'website', 'Klubz Korner', 'https://klubzkorner.com', true, 'Hospitality', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 170, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('elite-management-ny', 'website', 'Elite Management NY', 'https://elitemanagementny.com', true, 'Property Management', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 180, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('lumina-comfort', 'website', 'Lumina Comfort', 'https://luminacomfort.com', true, 'HVAC', NULL, 'Lead capture', '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', true, 190, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('little-gem-daycare', 'website', 'Little Gem Daycare', 'https://littlegemdaycare.com', true, 'Childcare', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 200, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('sound-rental-ny', 'website', 'Sound Rental NY', 'https://soundrentalny.com', true, 'Event Rentals', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 210, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('star-care-aba', 'website', 'Star Care ABA', 'https://starcareaba.com', true, 'ABA Therapy', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 220, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('the-workplace-uk', 'website', 'The Workplace UK', 'https://theworkplaceuk.co.uk', true, 'Workspace', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 230, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('at-foam', 'website', 'AT Foam', 'https://at-foam.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', false, 240, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('desert-lifeguard', 'website', 'Desert Lifeguard', 'https://desertlifeguard.com', true, 'Pool Services', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 250, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('whipple-tree-service', 'website', 'Whipple Tree Service', 'https://whippletreeservice.com', true, 'Tree Services', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 260, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('prowasher', 'website', 'ProWasher', 'https://prowasher.com', true, 'Pressure Washing', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 270, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('my-painter-gainesville', 'website', 'My Painter Gainesville', 'https://mypaintergainesville.com', true, 'Painting', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 280, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('my-painter-fairfax', 'website', 'My Painter Fairfax', 'https://mypainteroffairfax.com', true, 'Painting', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 290, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('my-painter-ashburn', 'website', 'My Painter Ashburn', 'https://mypainterashburn.com', true, 'Painting', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 300, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('my-denver-painter', 'website', 'My Denver Painter', 'https://mydenverpainter.com', true, 'Painting', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 310, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('pinnacle-plumbing', 'website', 'Pinnacle Plumbing', 'https://thepinnacleplumbing.com', true, 'Plumbing', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 320, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('hydrotech-plumbing', 'website', 'HydroTech Plumbing', 'https://hydrotechplumbingpros.com', true, 'Plumbing', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 330, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('leavitt-plumbing', 'website', 'Leavitt Plumbing', 'https://leavittplumbing.com', true, 'Plumbing', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 340, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('drain-cleaning-ne', 'website', 'Drain Cleaning NE', 'https://draincleaningne.com', true, 'Drain Cleaning', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', false, 350, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('drain-cleaning-omaha', 'website', 'Drain Cleaning Omaha', 'https://draincleaningomahane.com', true, 'Drain Cleaning', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 360, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('purlevel', 'website', 'PurLevel', 'https://purlevel.com', true, 'Concrete Leveling', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 370, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('jpr-concrete-walls', 'website', 'JPR Concrete & Walls', 'https://jprconcreteandwalls.com', true, 'Concrete', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', false, 380, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('dudley-concrete', 'website', 'Dudley Concrete', 'https://dudleyconcreteservices.com', true, 'Concrete', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 390, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('legacy-concrete-al', 'website', 'Legacy Concrete AL', 'https://legacyconcreteal.com', true, 'Concrete', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 400, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('red-rock-concrete', 'website', 'Red Rock Concrete', 'https://redrockconcretestg.com', true, 'Concrete', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 410, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('platinum-masonry-az', 'website', 'Platinum Masonry AZ', 'https://platinummasonryaz.com', true, 'Masonry', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', false, 420, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('platinum-asphalt-nv', 'website', 'Platinum Asphalt NV', 'https://platinumasphaltnv.com', true, 'Asphalt / Paving', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', false, 430, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('united-spray-foam-mi', 'website', 'United Spray Foam MI', 'https://unitedsprayfoammi.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 440, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('foamtastic-insulation', 'website', 'Foamtastic Insulation', 'https://foamtasticinsulation.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 450, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('sawlutions-foam', 'website', 'Sawlutions Foam', 'https://sawlutionsfoam.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 460, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('tech-hvac-foam', 'website', 'Tech HVAC Foam', 'https://techhvac-foam.com', true, 'HVAC / Insulation', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 470, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('spray-foam-pro', 'website', 'Spray Foam Pro', 'https://sprayfoamprollc.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 480, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('lone-star-thermal', 'website', 'Lone Star Thermal', 'https://lonestarthermal.com', true, 'Insulation', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 490, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('arklahoma-spray-foam', 'website', 'Arklahoma Spray Foam', 'https://arklahomasprayfoam.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 500, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('kirkwood-insulation', 'website', 'Kirkwood Insulation', 'https://kirkwoodinsulation.com', true, 'Insulation', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 510, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('sfg-pro-solutions', 'website', 'SFG Pro Solutions', 'https://sfgprosolutions.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 520, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('the-greatest-insulation', 'website', 'The Greatest Insulation', 'https://thegreatestinsulation.com', true, 'Insulation', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', false, 530, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('37-spray-foam', 'website', '37 Spray Foam', 'https://37sprayfoam.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', false, 540, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('spray-foam-giants', 'website', 'Spray Foam Giants', 'https://sprayfoamgiants.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 550, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('milo-insulation-east-tx', 'website', 'Milo Insulation East TX', 'https://miloinsulationeasttx.com', true, 'Insulation', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 560, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('go-getters-insulation', 'website', 'Go Getters Insulation', 'https://gogettersinsulation.com', true, 'Insulation', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 570, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('cr-spray-foam', 'website', 'CR Spray Foam', 'https://crsprayfoamco.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 580, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('foama-insulation', 'website', 'Foama Insulation', 'https://foamainsulation.com', true, 'Insulation', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 590, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('third-coast-spray-foam', 'website', 'Third Coast Spray Foam', 'https://thirdcoastsprayfoam.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 600, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('fm-spray-foam', 'website', 'FM Spray Foam', 'https://fmsprayfoam.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 610, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('usa-spray-me-sacramento', 'website', 'USA Spray Me Sacramento', 'https://usaspraymesacramento.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', false, 620, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('spray-foam-genius', 'website', 'Spray Foam Genius', 'https://sprayfoamgeniusinsulation.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 630, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('elevations-insulation', 'website', 'Elevations Insulation', 'https://elevationsinsulation.com', true, 'Insulation', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 640, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('tahoe-spray-foam', 'website', 'Tahoe Spray Foam', 'https://tahoesprayfoam.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 650, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('spray-foam-reno', 'website', 'Spray Foam Reno', 'https://sprayfoamreno.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', false, 660, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('energy-solutions-insulation', 'website', 'Energy Solutions Insulation', 'https://energysolutionsinsulation.com', true, 'Insulation', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 670, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('hch-spray-foam', 'website', 'HCH Spray Foam', 'https://hchsprayfoam.com', true, 'Spray Foam', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', false, 680, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('colorado-springs-grease-trap', 'website', 'Colorado Springs Grease Trap', 'https://coloradospringsgreasetrap.com', true, 'Grease Trap', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 690, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('tank-it-easy', 'website', 'Tank It Easy', 'https://tankiteasyco.com', true, 'Septic / Tanks', NULL, 'Multi-location', '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', true, 700, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('tank-it-easy-grease-trap', 'website', 'Tank It Easy Grease Trap', 'https://tankiteasygreasetrap.com', true, 'Grease Trap', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 710, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('tank-it-easy-co-springs', 'website', 'Tank It Easy CO Springs', 'https://tankiteasycosprings.com', true, 'Septic / Tanks', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 720, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('tank-it-easy-aurora', 'website', 'Tank It Easy Aurora', 'https://tankiteasyaurora.com', true, 'Septic / Tanks', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 730, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('tank-it-easy-elizabeth', 'website', 'Tank It Easy Elizabeth', 'https://tankiteasyelizabeth.com', true, 'Septic / Tanks', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 740, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('tank-it-easy-septic', 'website', 'Tank It Easy Septic', 'https://tankiteasyseptic.com', true, 'Septic / Tanks', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 750, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('bnf-dumpster', 'website', 'BNF Dumpster', 'https://bnfdumpster.com', true, 'Dumpster Rental', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 760, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('dumpster-rental-santa-rosa', 'website', 'Dumpster Rental Santa Rosa', 'https://dumpsterrentalsantarosa.com', true, 'Dumpster Rental', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 770, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('the-ark-dumpster-rental', 'website', 'The Ark Dumpster Rental', 'https://thearkdumpsterrental.com', true, 'Dumpster Rental', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 780, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('the-ark-hauling', 'website', 'The Ark Hauling', 'https://thearkhauling.com', true, 'Hauling', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 790, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('dams-moving', 'website', 'Dams Moving', 'https://damsmoving.com', true, 'Moving', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 800, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('acme-moving-rock-springs', 'website', 'ACME Moving Rock Springs', 'https://acmemovingrocksprings.com', true, 'Moving', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 810, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('ayala-landscape', 'website', 'Ayala Landscape', 'https://ayalalandscape.com', true, 'Landscaping', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 820, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('fresh-n-dri-carpet-cleaning', 'website', 'Fresh N Dri Carpet Cleaning', 'https://freshndricarpetcleaning.com', true, 'Cleaning', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 830, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('rejuve-hormones', 'website', 'Rejuve Hormones', 'https://rejuvehormones.com', true, 'Health & Wellness', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 840, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('heart-soul-wy', 'website', 'Heart & Soul WY', 'https://heartandsoulwy.com', true, 'Wellness', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 850, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('impact-skills', 'website', 'Impact Skills', 'https://impactskills.com', true, 'Education', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'none', 'ready', false, 860, 'legacy', 'Live client site from the portfolio page. Its screenshot was broken (noShot), so it waits in Needs review.'),
    ('legacy-one', 'website', 'Legacy One', 'https://legacy-one.com', true, 'Professional Services', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 870, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.'),
    ('property-one-lax', 'website', 'Property One LAX', 'https://propertyonelax.com', true, 'Property Management', NULL, NULL, '{}'::text[], NULL, NULL, NULL, NULL, 'mshots', 'published', false, 880, 'legacy', 'Live client site, listed on the portfolio page before the showcase existed.')
),
inserted AS (
  INSERT INTO public.showcase_items (
    slug, kind, title, url, link_public, industry, summary, result_tag,
    stack, accent, mockup_variant,
    image_key, image_key_small, image_source,
    status, home_featured, sort_order, consent, consent_note
  )
  SELECT slug, kind, title, url, link_public, industry, summary, result_tag,
         stack, accent, mockup_variant,
         image_key, image_key_small, image_source,
         status, home_featured, sort_order, consent, consent_note
    FROM seed
  ON CONFLICT (slug) DO NOTHING
  RETURNING status
)
SELECT public.write_audit_log(
         'showcase.seeded', 'showcase', NULL,
         jsonb_build_object(
           'rows', count(*),
           'published', count(*) FILTER (WHERE status = 'published'),
           'ready', count(*) FILTER (WHERE status = 'ready'),
           'source', 'site/src/app/(site)/portfolio/page.tsx'
         )
       )
  FROM inserted
HAVING count(*) > 0;

SELECT set_config('deskdev.showcase_seed', '', false);
