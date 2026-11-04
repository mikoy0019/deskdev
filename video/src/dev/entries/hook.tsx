import { registerRoot } from 'remotion';
import { sceneRoot } from '../SceneRoot';
import Scene from '../../scenes/Hook';

registerRoot(sceneRoot('hook', Scene));
