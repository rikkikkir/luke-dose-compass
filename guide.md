# Caring for an older dog at the end of life: an informed caregiver's guide

This guide is the content of the app's Understand tab. The guide covers general knowledge that stays true over time:

- what common lab values measure
- how common drug classes act
- how to read body language
- which changes may come, and how to prepare

**Luke's own numbers** are on the *His body* screen, with the date each was taken and its reference range.

**Status:**

- The guide is education, not veterinary advice.
- The guide is an unreviewed draft (VQ-15), so the Understand tab shows "Draft, not yet vet-reviewed."
- Terms link to his records.
- Vet questions link to his records by ID.

**Labels:**

- **Established:** standard veterinary knowledge.
- **Likely:** well supported; worth confirming for an individual dog.
- **VQ-n:** a question to bring to the vet.

---

## 1. Reading lab values

- **Creatinine** (glossary: `creatinine`): the main kidney-function number. Higher means the kidneys are filtering less.
- **SDMA** (symmetric dimethylarginine; glossary: `sdma`): a kidney marker that often rises before creatinine.
- **Kidney staging** (glossary: `iris`):
  - Vets stage chronic kidney disease from 1 to 4 using creatinine and SDMA.
  - The thresholds live in the settings under `iris`.
  - **Established:** staging applies only when a dog is stable and well hydrated, so a retest after a change in fluids or medication gives the truest picture (VQ-8).
- **BUN** (blood urea nitrogen; glossary: `bun`):
  - Rises with reduced kidney function, and also with dehydration, a recent protein meal, or bleeding in the stomach or gut.
  - A BUN out of proportion to creatinine is a classic reason to ask why (VQ-7).
  - **Likely:** high-dose diuretics such as furosemide, and NSAIDs such as carprofen, can each contribute.
- **ALT** (alanine aminotransferase; glossary: `alt`):
  - Rises when liver cells are stressed.
  - Causes in older dogs include medications, age-related liver changes, and other illness. The number alone doesn't say which (VQ-12).
- **Why labs matter for the app:** the kidneys and liver clear most drugs. When their values are raised, drugs may last longer, so the app widens the slow side of the estimates.

---

## 2. Drug classes: what each does, how a dog may feel, what to watch

**Furosemide (Lasix)** (glossary: `furosemide`)

- **What the drug does:** removes excess fluid by increasing urine.
- **How a dog may feel:** an urgent need to pee within about an hour of a dose, thirst, and possibly tiredness.
- **What to watch:**
  - drinking enough
  - signs of dehydration: dry or tacky gums, sunken eyes, skin slow to spring back
  - weakness, which can signal low potassium
- **Timing:** a dose shortly before sleep can cause nighttime urgency (VQ-2).

**Amantadine** (glossary: `amantadine`)

- **What the drug does:** turns down the nervous system's amplification of long-lasting pain. Works best alongside other pain relief. The benefit builds over days to weeks.
- **How a dog may feel:** gradually less background ache. Occasionally restlessness or an upset stomach.
- **Kidneys:** the kidneys clear amantadine (VQ-13).

**Opioids** (glossary: `opioid`)

- **What the drug does:** dampens pain signals in the brain and spinal cord.
- **How a dog may feel:** relief and drowsiness. Sometimes panting, or a dreamy or unsettled look.
- **What to watch:**
  - constipation
  - appetite changes
  - wobbliness, which raises the risk of falls in a dog with a weak leg

**NSAIDs** (non-steroidal anti-inflammatory drugs; glossary: `nsaid`)

- **What the drug does:** reduces inflammation and pain.
- **What to watch:**
  - vomiting
  - black or tarry stool
  - appetite drop
  - increased thirst
- **Kidneys:** NSAIDs need special care with kidney disease (VQ-1).

**Antacids**

- **What the drug does:** reduce stomach acid.
- **Why antacids matter:** kidney disease often causes queasiness, because waste products irritate the stomach. An antacid can bring a calmer stomach and a better appetite.

**Simethicone (Gas-X)** (glossary: `simethicone`)

- **What the drug does:** breaks up gas bubbles in the gut. The body doesn't absorb simethicone.
- **Important:** simethicone does **not** prevent or treat bloat (section 5).

**Supplements**

- Log each one.
- **Kidneys:** high-phosphorus products matter with kidney disease (VQ-14).

---

## 3. Reading body language

**Pain** (the app's pain check starts from the dog's own observed signs):

- panting at rest
- restlessness, or trouble getting comfortable
- licking one spot
- a hunched posture
- guarding an area
- slow rising
- a tense brow, squinting, or ears held back

**Nausea:**

- lip licking
- drooling
- repeated swallowing
- turning away from favorite food
- eating grass
- walking to the bowl, then leaving

**Anxiety or confusion:**

- pacing, especially at night
- staring
- getting stuck in corners
- clinginess or withdrawal

Age-related cognitive decline is common, and can look like pain. Logging helps tell the two apart.

**Comfort:**

- soft eyes
- a relaxed mouth
- sighing while settling
- stretching
- seeking company
- interest in smells
- enjoying meals

These signs belong in the log too.

---

## 4. Body systems over time

These are **possibilities, not predictions**.

**Joints and mobility**

- **Possible changes:** slower rising, slips and falls, trouble on stairs, eventually trouble standing unaided.
- **What helps:**
  - non-slip rugs
  - toe grips
  - a harness with a rear handle
  - ramps
  - an orthopedic bed
  - short, frequent walks
  - warmth on stiff joints
  - short nails
- **Ask the vet about:** rehabilitation and laser therapy.

**Kidneys**

- **Possible changes:** more thirst and urine, then reduced appetite, nausea, weight loss, bad breath, mouth sores, weakness.
- **What helps:**
  - steady hydration (warm, wet food helps)
  - a kidney-appropriate diet, with the vet's guidance on phosphorus
  - anti-nausea medication
  - fluids under the skin, if the vet recommends them

**Heart, lungs, and breathing** (glossary: `rrr`)

- **Established:** a normal resting breathing rate falls within the `breathing` range in `config.defaults.json`.
- **How to count:** count breaths during sleep for 30 seconds, then multiply by 2.
- **When to call:**
  - A rate consistently above the normal range: call the vet soon.
  - Labored breathing, a blue or gray tongue, or collapse: urgent.
- The Maven Pet sensor tracks resting breathing rate automatically (VQ-5).

**Stomach and appetite**

- **Possible changes:** picky eating, eating less, weight loss.
- **What helps:**
  - warmed food
  - small, frequent meals
  - hand-feeding
  - raised bowls
  - anti-nausea medication or appetite stimulants from the vet
- A falling appetite trend is one of the earliest useful signals.

**Skin and hygiene**

- **Possible changes:** pressure sores over the hips and elbows, and urine scald.
- **What helps:** padded bedding, gently turning a dog who no longer shifts on his own every few hours, washable pads, and gentle cleaning.

**Mind and mood**

- **Possible changes:** more sleep, confusion, restlessness at night.
- **What helps:** routine, a nightlight, a familiar voice and touch, and keeping the bed where life happens.

---

## 5. Urgent signs, even in comfort care

Call the vet, an emergency vet, or the hospice vet  for any of these:

- **Bloat (GDV, gastric dilatation-volvulus;** glossary: `gdv`):
  - retching without bringing anything up
  - a swollen or tight belly
  - drooling
  - restlessness
  - pale gums
  - **Established:** Weimaraners are a high-risk breed. Bloat usually needs surgery, so decide the plan in advance with the vet (VQ-9).
- **Breathing:** labored breathing, or a resting rate staying above the normal range.
- **Pain:** pain that medications no longer control.
- **Collapse or seizures.**
- **Urine:** no urine for many hours while on a diuretic.
- **Vomiting or stool:** repeated vomiting, or black, tarry stool.
- **Gums:** very pale, gray, or blue.

---

## 6. Quality of life

**The HHHHHMM scale** (glossary: `hhhhhmm`), by veterinary oncologist Dr. Alice Villalobos, scores seven areas. Scoring settings live in `config.defaults.json` under `qualityOfLife`.

1. **Hurt:** is pain controlled, including comfortable breathing?
2. **Hunger:** eating enough?
3. **Hydration:** drinking enough?
4. **Hygiene:** clean and comfortable?
5. **Happiness:** interest, joy, connection?
6. **Mobility:** moving enough to meet his needs?
7. **More good days than bad.**

The scale is a conversation tool, never a verdict (S7).

Two practices many hospice vets suggest:

- While the dog is doing well, write down **three things that make him himself**. When he can no longer do most of them, the list becomes a gentle guide.
- Watch whether **bad days start to outnumber good days**.

---

## 7. Preparing, so you can stay present

- **A comfort-care plan** (glossary: `comfort-care-plan`), written with the vet (VQ-11):
  - goals of care
  - what to do for bloat, breathing crises, and uncontrolled pain
  - medicines to keep on hand for bad nights (VQ-10)
  - whom to call, and in what order
- **Hospice support:** his records lists local options. Meeting a hospice vet early, while the dog is comfortable, lets that vet know him before any crisis.
- **When traveling:** carry the app's vet summary, the medications, and an emergency or hospice vet contact along the route.
- **Aftercare choices:** cremation (private or communal), burial, and keepsakes such as a paw print or fur clipping. These can all be decided in calm.
- **Caregiver care:** anticipatory grief, grieving while the dog is still here, is normal and common. Pet-loss support lines and groups exist, and asking for support is part of good caregiving.

---

## 8. How the app uses this guide

- **Tap to explain:** any glossary term in the app opens the matching explanation here.
- **Anticipation cards** appear gently when a trend shifts. Each card says what the change *may* mean, what helps, and which VQ to raise (S7).
- **Urgent signs** (section 5) sit on the crisis card (S8).

---

## Sources

- [IRIS staging system](https://www.iris-kidney.com/iris-staging-system) and [IRIS guidelines](https://www.iris-kidney.com/iris-guidelines-1)
- [IDEXX: SDMA and IRIS staging](https://www.idexx.com/en/veterinary/reference-laboratories/sdma/sdma-iris/)
- [VCA: Home breathing rate evaluation](https://vcahospitals.com/know-your-pet/home-breathing-rate-evaluation)
- [Tufts Cummings School: monitoring heart disease at home](https://vet.tufts.edu/foster-hospital-small-animals/specialty-services/cardiology/heartsmart/heart-disease-treatments/monitoring-heart-disease-treatment-home)
- [VCA: Quality of life at the end of life](https://vcahospitals.com/know-your-pet/quality-of-life-at-the-end-of-life-for-your-dog)
- [Lap of Love: end-of-life signs](https://www.lapoflove.com/blog/end-of-life-care-and-euthanasia/signs-dog-or-cat-is-dying-end-of-life-behaviors)
- [Merck Veterinary Manual: diuretics](https://www.merckvetmanual.com/pharmacology/systemic-pharmacotherapeutics-of-the-cardiovascular-system/diuretics-for-use-in-animals)
- [Merck Veterinary Manual: renal dysfunction](https://www.merckvetmanual.com/urinary-system/noninfectious-diseases-of-the-urinary-system-in-small-animals/renal-dysfunction-in-dogs-and-cats)
- [VETgirl: furosemide dos and don'ts](https://vetgirlontherun.com/dos-don%CA%BCts-furosemide-use-dogs-vetgirl-veterinary-continuing-education-blog/)
