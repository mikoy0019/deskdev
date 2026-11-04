import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { Alert, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useShallow } from 'zustand/react/shallow'

import { Button, Input } from '@/components/ui'
import { ColorPicker } from '@/components/forms'
import { centeredColumn, SHEET_MAX_WIDTH, useResponsive } from '@/lib/responsive'
import { CLIENT_COLORS, fonts, radius, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { ProjectCategory } from '@/lib/types'

/**
 * Manage the project categories of a single client. Tasks reuse the same
 * per-client taxonomy, so this is shared by the project and task forms.
 */
export function CategoryManager({
  visible, clientId, onClose,
}: {
  visible: boolean
  clientId: string
  onClose: () => void
}) {
  const p = useTheme()
  const { isTablet } = useResponsive()
  const categories = useStore(
    useShallow((s) =>
      s.projectCategories
        .filter((c) => c.clientId === clientId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    ),
  )
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  const addProjectCategory = useStore((s) => s.addProjectCategory)
  const updateProjectCategory = useStore((s) => s.updateProjectCategory)
  const deleteProjectCategory = useStore((s) => s.deleteProjectCategory)

  const [name, setName] = useState('')
  const [color, setColor] = useState(CLIENT_COLORS[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const usage = (id: string) =>
    projects.filter((pr) => pr.categoryId === id).length +
    tasks.filter((t) => t.categoryId === id).length

  const add = () => {
    const n = name.trim()
    if (!n) return
    addProjectCategory({ clientId, name: n, color })
    setName('')
  }

  const startEdit = (cat: ProjectCategory) => {
    setEditingId(cat.id)
    setEditName(cat.name)
  }

  const saveEdit = (id: string) => {
    const n = editName.trim()
    if (!n) return
    updateProjectCategory(id, { name: n })
    setEditingId(null)
  }

  const remove = (cat: ProjectCategory) => {
    const n = usage(cat.id)
    Alert.alert(
      'Delete category?',
      `"${cat.name}" will be removed${n > 0 ? ` and unassigned from ${n} item${n === 1 ? '' : 's'}` : ''}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteProjectCategory(cat.id) },
      ],
    )
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={isTablet && Platform.OS === 'ios' ? 'formSheet' : undefined}
      onRequestClose={onClose}
    >
      <SafeAreaView
        edges={['top', 'bottom']}
        style={[{ flex: 1, backgroundColor: p.page }, isTablet ? centeredColumn(SHEET_MAX_WIDTH) : null]}
      >
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: p.border,
          }}
        >
          <Text style={{ fontSize: 17, fontFamily: fonts.display, color: p.textHigh }}>Manage categories</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Feather name="x" size={22} color={p.iconMuted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Input
                value={name}
                onChangeText={setName}
                placeholder="New category name"
                style={{ flex: 1 }}
                onSubmitEditing={add}
              />
              <Pressable
                onPress={add}
                style={{ width: 44, borderRadius: radius.md, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center' }}
              >
                <Feather name="plus" size={20} color="#ffffff" />
              </Pressable>
            </View>
            <ColorPicker value={color} onChange={setColor} />
          </View>

          <View style={{ gap: 8 }}>
            {categories.length === 0 ? (
              <Text style={{ color: p.textMuted, fontSize: 13, fontFamily: fonts.sans, textAlign: 'center', paddingVertical: 16 }}>
                No categories for this client yet.
              </Text>
            ) : (
              categories.map((cat) => (
                <View
                  key={cat.id}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    backgroundColor: p.card, borderColor: p.border, borderWidth: 1,
                    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
                  }}
                >
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: cat.color ?? p.iconMuted }} />
                  {editingId === cat.id ? (
                    <Input
                      value={editName}
                      onChangeText={setEditName}
                      autoFocus
                      style={{ flex: 1 }}
                      onSubmitEditing={() => saveEdit(cat.id)}
                    />
                  ) : (
                    <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.sans, color: p.textHigh }}>{cat.name}</Text>
                  )}
                  <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted, fontVariant: ['tabular-nums'] }}>{usage(cat.id)}</Text>
                  {editingId === cat.id ? (
                    <Pressable onPress={() => saveEdit(cat.id)} hitSlop={8}>
                      <Feather name="check" size={18} color={p.brandText} />
                    </Pressable>
                  ) : (
                    <Pressable onPress={() => startEdit(cat)} hitSlop={8}>
                      <Feather name="edit-2" size={16} color={p.iconMuted} />
                    </Pressable>
                  )}
                  <Pressable onPress={() => remove(cat)} hitSlop={8}>
                    <Feather name="trash-2" size={16} color={p.danger} />
                  </Pressable>
                </View>
              ))
            )}
          </View>
        </ScrollView>

        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: p.border }}>
          <Button title="Done" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  )
}
