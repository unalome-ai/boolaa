import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Platform, useColorScheme, Alert, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
import { supabase } from '../supabaseClient'; // Adjust path if needed

interface FoodSheetProps {
  visible: boolean;
  onClose: () => void;
  onSave?: (food: { id?: string; desc: string; image: string; }) => void;
  initialFood?: any;
}

export default function FoodSheet({ visible, onClose, onSave, initialFood }: FoodSheetProps) {
  const colorScheme = useColorScheme() as string | null;
  const styles = themedStyles(colorScheme);
  const [desc, setDesc] = useState('');
  const [image, setImage] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (visible && initialFood) {
      setDesc(initialFood.desc || '');
      setImage(initialFood.image || '');
    } else if (visible) {
      setDesc('');
      setImage('');
    }
  }, [visible, initialFood]);

  // Helper: Upload image to Supabase Storage and return public URL
  const uploadImageAsync = async (uri: string) => {
    try {
      setUploading(true);
      // Get file info
      const fileExt = uri.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `food.images/${fileName}`;

      // Read file as base64
      const fileData = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const contentType = 'image/' + (fileExt === 'jpg' ? 'jpeg' : fileExt);

      // Upload to Supabase Storage
      const { error } = await supabase.storage
        .from('food.images') // Your bucket name
        .upload(filePath, Buffer.from(fileData, 'base64'), {
          contentType,
          upsert: true,
        });

      if (error) throw error;

      // Get public URL
      const { data } = supabase.storage.from('food.images').getPublicUrl(filePath);
      if (!data?.publicUrl) throw new Error('Failed to get public URL');
      setUploading(false);
      return data.publicUrl;
    } catch (err: any) {
      setUploading(false);
      Alert.alert('Upload Error', err.message || 'Failed to upload image');
      return '';
    }
  };

  // Unified handler for picking or taking a photo
  const handleAddPhoto = () => {
    Alert.alert(
      'Add Photo',
      'Choose an option',
      [
        { text: 'Select from Photos', onPress: pickImage },
        { text: 'Take Picture', onPress: takePhoto },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  // Pick image from library
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      const url = await uploadImageAsync(uri);
      if (url) setImage(url);
    }
  };

  // Take photo with camera
  const takePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      const url = await uploadImageAsync(uri);
      if (url) setImage(url);
    }
  };

  const handleSave = () => {
    if (!desc.trim()) {
      Alert.alert('Missing Description', 'Please enter a description for the food.');
      return;
    }
    if (onSave) onSave({ id: initialFood?.id, desc, image });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheetContainer}>
          <View style={styles.dragHandle} />
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
            <Ionicons name="close" size={28} color={colorScheme === 'dark' ? '#fff' : '#9D78BD'} />
          </TouchableOpacity>
          <Text style={styles.sheetTitle}>{initialFood ? 'Edit Food' : 'Share Food'}</Text>
          <TextInput
            style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
            placeholder="Food Description"
            placeholderTextColor={colorScheme === 'dark' ? '#aaa' : '#888'}
            value={desc}
            onChangeText={setDesc}
            multiline
            numberOfLines={4}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <TouchableOpacity
              style={[styles.saveBtn, { flex: 1, backgroundColor: '#7B61FF' }]}
              onPress={handleAddPhoto}
              disabled={uploading}
            >
              <Ionicons name="image-outline" size={20} color="#fff" style={{ marginRight: 4 }} />
              <Text style={styles.saveText}>{image ? 'Change Photo' : 'Add Photo'}</Text>
            </TouchableOpacity>
            {image ? (
              <TouchableOpacity
                style={{ marginLeft: 12, padding: 4 }}
                onPress={() => setImage('')}
                disabled={uploading}
              >
                <Ionicons name="close-circle" size={24} color="#FF4D4F" />
              </TouchableOpacity>
            ) : null}
          </View>
          {uploading && <ActivityIndicator size="small" color="#9D78BD" style={{ marginBottom: 12 }} />}
          {image ? (
            <Image source={{ uri: image }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 16 }} />
          ) : null}

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={uploading}>
            <Text style={styles.saveText}>{initialFood ? 'Save Changes' : 'Share Food'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function themedStyles(colorScheme: string | null) {
  const isDark = colorScheme === 'dark';
  return StyleSheet.create({
    sheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.3)',
      justifyContent: 'flex-end',
    },
    sheetContainer: {
      backgroundColor: isDark ? '#23232b' : '#fff',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingBottom: Platform.OS === 'ios' ? 32 : 16,
      paddingTop: 8,
      minHeight: '40%',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 10,
      paddingHorizontal: 24,
    },
    dragHandle: {
      width: 40,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: isDark ? '#444' : '#ccc',
      alignSelf: 'center',
      marginBottom: 12,
    },
    closeBtn: {
      position: 'absolute',
      top: 16,
      right: 16,
      zIndex: 10,
    },
    sheetTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: isDark ? '#fff' : '#222',
      marginBottom: 18,
      alignSelf: 'center',
    },
    input: {
      backgroundColor: isDark ? '#18181b' : '#f5f5f5',
      color: isDark ? '#fff' : '#222',
      borderRadius: 10,
      padding: 14,
      fontSize: 16,
      marginBottom: 16,
    },
    saveBtn: {
      backgroundColor: '#9D78BD',
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 0,
      flexDirection: 'row',
      justifyContent: 'center',
    },
    saveText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 16,
    },
  });
}
