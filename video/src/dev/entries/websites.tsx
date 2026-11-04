import { registerRoot } from 'remotion';
import { sceneRoot } from '../SceneRoot';
import Scene from '../../scenes/Websites';

registerRoot(sceneRoot('websites', Scene));
