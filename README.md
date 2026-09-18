# Baguette Run

An 8-bit style browser game. Run a bakery: bake baguettes to match each
customer's order (some want toppings like cinnamon or powdered sugar,
others plain), then hop on your bike for a first-person ride down the
neighborhood street, dodging traffic until you reach their house.

No build step, no dependencies — just open `index.html` in a browser
(or serve the folder with any static file server).

## How to play

**Shop phase**
1. Read the order card (customer + requested toppings).
2. Click through **Knead Dough** → **Shape Loaf**.
3. Watch the bake gauge and click **Pull From Oven!** when the needle
   is in the golden zone — too early is raw, too late is burnt.
4. Toggle the toppings that match the order, then **Wrap & Go**.

**Delivery phase — first-person street ride**
- The road scrolls toward you pseudo-3D, Outrun/Traffic-Rider style,
  winding past houses and trees.
- Steer with **Left/Right** (Arrow keys or A/D), or tap/hold the left
  or right edge of the screen on touch devices.
- **Up/W** accelerates, **Down/S** brakes — useful for lining up the
  final approach.
- Oncoming traffic (headlights) and same-direction traffic (taillights)
  share the road in three lanes — weave around them.
- A progress bar along the top shows how far you are from the order's
  destination. When you reach it, steer to the correct side (shown at
  the bottom of the screen) to pull into the glowing driveway.
- Crashing into a car costs a life and knocks you back a bit (with
  brief invincibility). Riding past the house on the wrong side also
  costs a life and restarts that delivery run.
- 3 lives total. Deliver enough orders to advance to the next day —
  traffic gets denser and curves get sharper as you go.

Press **P** to pause during either phase.

Score comes from how well the baguette matched the order (Perfect /
Good / Okay / Ruined) plus a bonus for delivering promptly.
