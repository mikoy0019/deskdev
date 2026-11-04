import { registerRoot } from 'remotion';
import { sceneRoot } from '../SceneRoot';
import Scene from '../../scenes/Apps';

registerRoot(sceneRoot('apps', Scene));
