import { registerRoot } from 'remotion';
import { sceneRoot } from '../SceneRoot';
import Scene from '../../scenes/WhoFor';

registerRoot(sceneRoot('whofor', Scene));
