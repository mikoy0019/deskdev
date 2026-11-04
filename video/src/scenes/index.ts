import type React from 'react';
import type { SceneId } from '../timeline';
import Hook from './Hook';
import Who from './Who';
import Leaks from './Leaks';
import Reframe from './Reframe';
import Offers from './Offers';
import Websites from './Websites';
import Automation from './Automation';
import Apps from './Apps';
import Devs from './Devs';
import Proof from './Proof';
import Process from './Process';
import Risk from './Risk';
import WhoFor from './WhoFor';
import Cta from './Cta';

export const SCENE_COMPONENTS: Record<SceneId, React.ComponentType> = {
  hook: Hook,
  who: Who,
  leaks: Leaks,
  reframe: Reframe,
  offers: Offers,
  websites: Websites,
  automation: Automation,
  apps: Apps,
  devs: Devs,
  proof: Proof,
  process: Process,
  risk: Risk,
  whofor: WhoFor,
  cta: Cta,
};
