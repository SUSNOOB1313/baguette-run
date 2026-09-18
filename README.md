# Baguette Run

An 8-bit style browser game. Run a bakery: bake baguettes to match each
customer's order (some want toppings like cinnamon or powdered sugar,
others plain), then hop on your bike and dodge cars across the
neighborhood street to deliver it before time runs out.

No build step, no dependencies — just open `index.html` in a browser
(or serve the folder with any static file server).

## How to play

**Shop phase**
1. Read the order card (customer + requested toppings).
2. Click through **Knead Dough** → **Shape Loaf**.
3. Watch the bake gauge and click **Pull From Oven!** when the needle
   is in the golden zone — too early is raw, too late is burnt.
4. Toggle the toppings that match the order, then **Wrap & Go**.

**Delivery phase**
- Move with Arrow Keys / WASD.
- Dodge the traffic lanes and reach the glowing house — that's your
  customer's home.
- Getting hit by a car costs a life and sends you back to the start of
  the street (with brief invincibility). Running out of time also costs
  a life.
- 3 lives total. Deliver enough orders to advance to the next day —
  traffic gets busier and the bake window gets tighter as you go.

Press **P** to pause during either phase.

Score comes from how well the baguette matched the order (Perfect /
Good / Okay / Ruined) plus a speed bonus for delivering quickly.
