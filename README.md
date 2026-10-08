# Baguette Run

An 8-bit style browser game. Run a bakery: bake baguettes to match each
customer's order (some want toppings like cinnamon or powdered sugar,
others plain), then hop on your bike for a first-person ride down the
neighborhood street, dodging traffic until you reach their house.

No build step, no dependencies — just open `index.html` in a browser
(or serve the folder with any static file server).

## How to play

**Shop phase**
1. Read the order card (customer, product, and requested toppings).
   Most orders are a whole baguette, but some ask for a tray of
   Baguette Bites (6 or 12) or a single ring-shaped Bagelette instead —
   all three can be topped the same way.
2. Click through **Knead Dough** → **Shape Loaf**.
3. Drag the oven's door handle **down** to pull it open — just once,
   even for a tray of bites. Then click the peel's handle and drag it
   in to push an item to the back; for a tray, drag it in again for
   each remaining bite one at a time (no need to reopen the door
   between them). Once everything's loaded, drag the door handle back
   **up** to close the oven. There's no gauge or needle — just watch
   the bread's actual color through the oven window as it bakes (pale
   dough → golden brown → black) and press **B** to pull it whenever
   it looks right to you. Too pale is raw, too dark is burnt.
4. Pick up a topping bottle and lift it up to tip it over — hold it
   there as long as you like for a heavier coating, or just dab it
   for a light one. It only actually lands if the bottle's cap is
   lined up with the baguette; hold it off to the side and it just
   spills on the counter instead. Match the order, then **Wrap & Go**.

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

Wrapping an order shows how well the baguette matched it (Perfect /
Good / Okay / Ruined), but that's just a quality check — the only
money you actually earn is the tip paid out when you successfully
reach the house, usually $4 and occasionally as much as $7.
