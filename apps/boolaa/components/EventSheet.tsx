import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Platform, useColorScheme, Alert } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

interface EventSheetProps {
  visible: boolean;
  onClose: () => void;
  onSave?: (event: { id?: string; title: string; description: string; datetime: Date; location: string }) => void;
  initialEvent?: any;
}

export default function EventSheet({ visible, onClose, onSave, initialEvent }: EventSheetProps) {
  const colorScheme = useColorScheme();
  const styles = themedStyles(colorScheme);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [datetime, setDatetime] = useState(new Date());
  const [showDate, setShowDate] = useState(false);

  React.useEffect(() => {
    if (visible && initialEvent) {
      setTitle(initialEvent.title || '');
      setDescription(initialEvent.description || '');
      setLocation(initialEvent.location || '');
      setDatetime(initialEvent.datetime ? new Date(initialEvent.datetime) : new Date());
    } else if (visible) {
      setTitle('');
      setDescription('');
      setLocation('');
      setDatetime(new Date());
    }
  }, [visible, initialEvent]);

  const handleSave = () => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for the event.');
      return;
    }
    if (onSave) onSave({ id: initialEvent?.id, title, description, datetime, location });
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
          <Text style={styles.sheetTitle}>Create Event</Text>
          <TextInput
            style={styles.input}
            placeholder="Event Title"
            placeholderTextColor={colorScheme === 'dark' ? '#aaa' : '#888'}
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
            placeholder="Event Description (optional)"
            placeholderTextColor={colorScheme === 'dark' ? '#aaa' : '#888'}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
          />
          <TouchableOpacity onPress={() => setShowDate(true)} style={styles.inputRow}>
            <Ionicons name="calendar-outline" size={20} color="#9D78BD" style={{ marginRight: 8 }} />
            <Text style={styles.inputText}>{datetime.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</Text>
          </TouchableOpacity>
          {showDate && (
            <DateTimePicker
              value={datetime}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(_, date) => {
                setShowDate(false);
                if (date) setDatetime(date);
              }}
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="Location (optional)"
            placeholderTextColor={colorScheme === 'dark' ? '#aaa' : '#888'}
            value={location}
            onChangeText={setLocation}
          />
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveText}>Save Event</Text>
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
      minHeight: '50%',
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
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#18181b' : '#f5f5f5',
      borderRadius: 10,
      padding: 14,
      marginBottom: 16,
    },
    inputText: {
      color: isDark ? '#fff' : '#222',
      fontSize: 16,
    },
    saveBtn: {
      backgroundColor: '#9D78BD',
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 12,
    },
    saveText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 16,
    },
  });
}
