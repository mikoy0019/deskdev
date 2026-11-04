import { registerRoot } from 'remotion';
import { sceneRoot } from '../SceneRoot';
import Scene from '../../scenes/Reframe';

registerRoot(sceneRoot('reframe', Scene));
