import { Redirect } from 'expo-router';
import { GalleryScreen } from '../screens/gallery';

export default function Gallery() {
  return __DEV__ ? <GalleryScreen /> : <Redirect href="/" />;
}
