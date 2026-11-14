// Short "how to" notes for each exercise, written once for this app.
// Matching ignores case, spaces and punctuation. If no key matches exactly, the longest key found inside the name is used.

const LIST = [
  [['kneetowallanklerocks', 'kneetowall', 'anklerocks'], 'Half kneel facing a wall with the front toes a few centimetres away. Rock the front knee forward over the toes until it touches the wall, heel staying down, then rock back. Loosens the ankle so squats and lunges sit deeper and feel steadier.'],
  [['bandedanklemobilisation', 'bandedanklemobilization', 'anklemobilisation'], 'Loop a band low around the front of the ankle, anchored behind you, and kneel with that foot forward. Drive the knee forward over the toes while the band draws the ankle back, heel flat. Frees up a stiff ankle.'],
  [['bodyweightsquattobox', 'squattobox', 'boxsquat'], 'Stand in front of a box or bench, feet about shoulder width. Sit back and down under control until you lightly touch the box, then stand by pushing through the whole foot, knees tracking over the toes. Grooves a safe, repeatable squat.'],
  [['armcircles'], 'Stand tall with arms out to the sides. Draw slow circles, small to large, forwards then backwards. Warms the shoulders and upper back before pressing and pulling.'],
  [['pressuprelease', 'handreleasepressup', 'handreleasepushup'], 'A press-up where you lower all the way to the floor, lift your hands off for a moment, then replace them and press back up. Keep a straight line from head to heels. Warms up the chest, shoulders and triceps through a full range.'],
  [['pressup', 'pushup'], 'Hands under the shoulders, body in one straight line. Lower your chest towards the floor with elbows at about 45 degrees, then push back up. Drop to the knees to make it easier. Works chest, shoulders, triceps and core.'],
  [['dbbenchpress', 'dumbbellbenchpress', 'dbchestpress', 'dumbbellchestpress', 'dbpress'], 'Lie on a flat bench with a dumbbell in each hand above the chest. Lower them to the sides of the chest, elbows about 45 degrees from your body, then press back up. Feet planted, shoulder blades back and down. Works chest, shoulders and triceps.'],
  [['barbenchpress', 'barbellbenchpress', 'benchpress'], 'Lie on a flat bench and grip the bar a little wider than your shoulders. Lower it to mid chest under control, then press back up. Feet planted and shoulder blades squeezed together. Works chest, shoulders and triceps.'],
  [['inclinebenchpress', 'inclinebench', 'inclinedbpress', 'inclinepress', 'inclinedumbbellpress'], 'On a bench set to about 30 degrees, press the bar or dumbbells from the upper chest to straight arms above you, then lower slowly. Targets the upper chest and front of the shoulders.'],
  [['chestpressfixedmachine', 'machinechestpress', 'chestpressmachine', 'chestpress'], 'Sit with your back flat on the pad and the handles level with mid chest. Press forward until your arms are nearly straight, then return slowly. The machine guides the path so you can push hard with good control. Works chest, shoulders and triceps.'],
  [['chestsupporteddbrow', 'chestsupportedrow', 'chestsupporteddb', 'chestsupporteddumbbellrow'], 'Lie face down on an incline bench with a dumbbell in each hand hanging below. Row them up towards your hips, squeezing the shoulder blades together, then lower slowly. The bench takes the load off your lower back. Works the upper back and lats.'],
  [['latpulldown', 'latpull', 'pulldown'], 'Sit with your thighs under the pads and grip the bar a little wider than your shoulders. Pull it to the top of your chest, leading with the elbows and keeping your chest up, then let it rise slowly. Works the lats and upper back.'],
  [['facepulls', 'facepull'], 'Set a cable with a rope at about head height. Pull the rope towards your face, splitting the ends so your elbows finish high and wide and your hands beside your ears. Strengthens the rear shoulders and upper back, good for posture and shoulder health.'],
  [['hammercurl', 'hammer'], 'Stand holding dumbbells at your sides with palms facing in. Curl them up, elbows tucked to your sides and palms still facing each other, then lower slowly. Works the biceps and forearms.'],
  [['cablebicepcurl', 'cablebicepscurl', 'cablecurl'], 'Face a low cable holding the bar or handle palms up, elbows pinned at your sides. Curl up by bending only at the elbow, squeeze, then lower slowly without letting the shoulders roll forward. The cable keeps the biceps working through the whole movement.'],
  [['bicepcurl', 'bicepscurl', 'dumbbellcurl', 'barbellcurl'], 'Hold the weights palms up with elbows pinned at your sides. Curl up by bending only at the elbow, squeeze at the top, then lower slowly with no swinging. Works the biceps.'],
  [['triceppulldowns', 'triceppulldown', 'triceppushdown', 'tricepspushdown', 'triceppushdowns', 'cabletricep'], 'Face a high cable with a rope or bar, elbows tucked at your sides. Push down until your arms are straight, then let it rise slowly to about chest height. Only the forearms move. Works the triceps.'],
  [['seatedcablerow', 'cablerow', 'lowrow'], 'Sit at the low cable with feet braced and knees slightly bent. Pull the handle to your lower ribs, chest up and shoulder blades squeezing together, then let your arms extend slowly without rounding forward. Works the middle back and lats.'],
  [['bentoverroworcablerow', 'bentoverrow', 'barbellrow', 'dumbbellrow', 'dbrow'], 'Hinge forward from the hips with a flat back and soft knees, holding a bar or dumbbells. Row the weight to your lower ribs, squeeze the shoulder blades, then lower slowly. Use the seated cable row instead if your lower back needs a break. Works the upper back and lats.'],
  [['machinerow', 'seatedrow'], 'Sit with your chest against the pad and take the handles. Pull them back towards your ribs, squeezing the shoulder blades together, then return slowly. The pad supports you so the back muscles do the work.'],
  [['sittostand'], 'Sit on the front half of a chair or box with feet hip width apart. Stand up by pushing through the whole foot without using your hands, then sit back down slowly. Builds leg strength and control.'],
  [['slsittostand', 'singlelegsittostand'], 'Sit-to-stand on one leg: sit on a box with one foot planted and the other held just off the floor. Stand and sit using only the working leg, knee in line with the toes. Works the quads and glutes of each leg on its own.'],
  [['glutebridgesl', 'singlelegglutebridge', 'slglutebridge', 'glutebridgesinglelegged'], 'Lie on your back with one foot flat on the floor and the other leg lifted. Push through the planted heel to lift your hips until knee, hip and shoulder line up, pause, then lower slowly. Keep the hips level. Works the glute and hamstring of the planted leg.'],
  [['glutebridge'], 'Lie on your back, knees bent and feet flat. Push through your heels to lift the hips until knees, hips and shoulders line up, squeeze the glutes, then lower slowly. Works the glutes and hamstrings.'],
  [['hamstringbridge', 'hamtringbridge'], 'Lie on your back with your heels on a bench or on the floor further from you than a normal bridge. Dig the heels in and lift the hips, pause, lower slowly. With hip flexion: draw one knee towards your chest as you lift. Works hamstrings, glutes and core.'],
  [['clamshell', 'clamshells'], 'Lie on your side with hips and knees bent and feet together. Keeping the feet touching and your hips still, lift the top knee, then lower slowly. Works the side of the glute, which helps keep the hip and knee stable.'],
  [['calfraises', 'calfraise'], 'Stand on the edge of a step with your heels hanging off, holding something for balance. Rise onto your toes as high as you can, pause, then lower the heels below the step. Works the calves.'],
  [['slbalance', 'singlelegbalance', 'singlelegstand'], 'Stand on one leg with a soft knee and level hips for the set time. Make it harder by closing your eyes or standing on a cushion. Trains balance and the small stabilising muscles around the ankle, knee and hip.'],
  [['sideplank'], 'Lie on your side with the elbow under the shoulder and feet stacked. Lift your hips so your body makes a straight line, push the hips slightly forward and hold. Works the obliques and side of the hip. Bend the knees to make it easier.'],
  [['plank'], 'Forearms on the floor, elbows under the shoulders, body in a straight line from head to heels. Brace your stomach and squeeze your glutes, then hold. Works the whole core.'],
  [['bulgarianss', 'bulgariansplitsquat', 'bulgarian', 'rearfootelevatedsplitsquat'], 'Stand a stride in front of a bench and rest the top of your back foot on it. Lower straight down until the front thigh is close to level, then drive up through the front foot. Most of your weight stays on the front leg. Works quads and glutes, one leg at a time.'],
  [['supportedsplitsquat', 'splitsquat'], 'Stand in a long split stance holding a rail or wall for support. Lower the back knee towards the floor with most of your weight on the front leg, then push back up through the front foot. Works quads and glutes; control matters more than depth.'],
  [['cablepulloffpress', 'pallofpress', 'pullofpress', 'paloffpress'], 'Stand side on to a cable set at chest height, holding the handle at your chest with both hands. Press it straight out, hold for a moment while resisting the pull that tries to twist you, then bring it back. Builds core stability against rotation.'],
  [['legpress'], 'Sit in the machine with feet hip width apart on the platform. Lower the platform under control until your knees are bent to about 90 degrees, then push back up without locking the knees. Works quads and glutes.'],
  [['gobletsquat'], 'Hold a dumbbell or kettlebell at your chest. Squat down between your knees, chest up and heels flat, then stand. Works quads and glutes and is easy on the back.'],
  [['romaniandeadlift', 'rdl', 'stifflegdeadlift'], 'Hold a bar or dumbbells in front of your thighs. Push your hips back with a flat back and soft knees, sliding the weight down your legs until you feel the hamstrings stretch, then drive the hips forward to stand. Works hamstrings and glutes.'],
  [['deadlift'], 'Stand with the bar over your mid foot. Hinge down and grip it, flatten your back, then stand up by pushing the floor away, keeping the bar close. Lower it the same way. Works the whole back of the body.'],
  [['hipthrust'], 'Sit with your upper back against a bench and a weight across your hips. Drive through your heels to lift the hips until your body is flat from knee to shoulder, squeeze, then lower. Works the glutes.'],
  [['stepup', 'stepups'], 'Place one foot on a box or bench. Push through that foot to stand up on it, then step down slowly. Keep the knee in line with the toes. Works quads and glutes, one leg at a time.'],
  [['lunge', 'lunges', 'walkinglunge'], 'Step forward and lower until both knees are bent to about 90 degrees, front knee over the ankle, then push back to standing. Works quads and glutes.'],
  [['legcurl', 'hamstringcurl'], 'In the machine, curl the pad towards your glutes by bending the knees, squeeze, then lower slowly. Works the hamstrings.'],
  [['legextension'], 'Sit in the machine with the pad on your lower shins. Straighten your legs, pause, then lower slowly. Works the quads.'],
  [['shoulderpress', 'overheadpress', 'dbshoulderpress', 'militarypress'], 'Seated or standing, hold the weights at shoulder height. Press them overhead until your arms are straight, then lower slowly to the shoulders. Keep your ribs down and do not arch the lower back. Works the shoulders and triceps.'],
  [['lateralraise', 'lateralraises', 'sideraise'], 'Hold light dumbbells at your sides. Raise them out to the sides to shoulder height with a slight bend in the elbows, then lower slowly. Works the side of the shoulders.'],
  [['chestfly', 'cablefly', 'dbfly', 'pecdeck'], 'With arms wide and a slight bend in the elbows, bring the handles or dumbbells together in front of your chest in a hugging arc, then open back out slowly. Works the chest.'],
  [['pullup', 'chinup', 'assistedpullup'], 'Hang from the bar and pull your chest towards it, leading with the elbows, then lower all the way under control. Use the assisted machine or a band if needed. Works the lats, upper back and biceps.'],
  [['deadbug'], 'Lie on your back with arms up and knees bent above the hips. Press your lower back into the floor, then slowly lower the opposite arm and leg, return and switch. Works deep core control.'],
];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const EXACT = new Map();
const PARTS = [];
LIST.forEach(([keys, text]) => keys.forEach((k) => { EXACT.set(k, text); PARTS.push([k, text]); }));
PARTS.sort((a, b) => b[0].length - a[0].length);

export function describe(name) {
  const n = norm(name);
  if (!n) return '';
  if (EXACT.has(n)) return EXACT.get(n);
  const hit = PARTS.find(([k]) => k.length >= 5 && n.includes(k));
  return hit ? hit[1] : '';
}
